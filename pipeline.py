#!/usr/bin/env python3
"""Pipeline "Rzeszów w pikselach": pobiera aktualny GTFS i buduje dist/index.html.

Przeznaczony do uruchamiania z crona (albo Harmonogramu zadań w Windows):
  * pobiera paczki GTFS ze źródeł w kolejności priorytetu (z ETag / If-Modified-Since),
  * wybiera pierwszą poprawną paczkę, która obejmuje dzisiejszą datę,
  * buduje stronę tylko wtedy, gdy zmieniły się dane albo kod (chyba że --force),
  * waliduje wynik i podmienia dist/index.html atomowo — przy błędzie zostaje poprzednia wersja,
  * archiwizuje użyte paczki, pilnuje, by dwa uruchomienia nie nachodziły na siebie,
  * opcjonalnie odpala komendę po udanym buildzie (np. rsync na serwer).

Kody wyjścia: 0 = zbudowano albo bez zmian, 1 = żadne źródło nie zadziałało,
              2 = build nie przeszedł walidacji, 3 = błąd komendy post_build.

Użycie:  python3 pipeline.py [--config pipeline.json] [--force] [--verbose]
"""
import argparse
import datetime as dt
import email.utils
import gzip
import hashlib
import json
import logging
import logging.handlers
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from prep import prepare, REQUIRED  # noqa: E402
from build import build, sources  # noqa: E402
import osm  # noqa: E402

DEFAULTS = {
    "sources": [
        {"name": "kmrzeszow", "url": "https://kmrzeszow.live/gtfs/latest.zip"},
        {"name": "mkuran", "url": "https://mkuran.pl/gtfs/rzeszow.zip"},
    ],
    "work_dir": "work",            # cache, stan, archiwum, logi
    "out_dir": "dist",             # tu ląduje gotowy index.html
    "template": "src/index.html",  # szablon strony; dołącza moduły z src/ (zob. build.py)
    "keep_archives": 14,
    "min_routes": 20,
    "min_trips": 1000,
    "min_stops": 300,
    "max_download_mb": 200,
    "timeout_s": 60,
    "retries": 3,
    "post_build": "",              # np. "rsync -az dist/ user@serwer:/var/www/rwp/"
    "addresses": {                 # punkty adresowe OSM do wyszukiwania "ulica numer"
        "enabled": True,
        "url": "https://overpass-api.de/api/interpreter",
        "bbox": [49.90, 21.78, 50.14, 22.26],   # płd, zach, płn, wsch — obszar sieci ZTM
        "max_age_days": 14,
        "timeout_s": 200,
    },
    "map": {                       # budynki, woda, teren, drogi i drzewa z OSM
        "enabled": True,
        "url": "https://overpass-api.de/api/interpreter",
        "bbox": [49.90, 21.78, 50.14, 22.26],
        "max_age_days": 14,
        "timeout_s": 300,
        "pause_s": 5,              # przerwa między zapytaniami (uprzejmość wobec serwera)
        "retry_pause_s": 30,
    },
}
USER_AGENT = "rzeszow-w-pikselach-pipeline/1.0"
log = logging.getLogger("rwp")


# ---------------------------------------------------------------- pomocnicze
def load_config(path):
    cfg = dict(DEFAULTS)
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            cfg.update(json.load(f))
    for k in ("work_dir", "out_dir", "template"):
        if not os.path.isabs(cfg[k]):
            cfg[k] = os.path.join(HERE, cfg[k])
    return cfg


def setup_logging(work_dir, verbose):
    os.makedirs(work_dir, exist_ok=True)
    log.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%Y-%m-%d %H:%M:%S")
    fh = logging.handlers.RotatingFileHandler(os.path.join(work_dir, "pipeline.log"), maxBytes=1_000_000,
                                              backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)
    log.addHandler(fh)
    sh = logging.StreamHandler(sys.stderr)
    sh.setFormatter(fmt)
    # w cronie stderr trafia do maila/logu systemowego, więc domyślnie tylko ostrzeżenia i błędy
    sh.setLevel(logging.INFO if verbose else logging.WARNING)
    log.addHandler(sh)


class Lock:
    """Blokada pliku: drugie uruchomienie w trakcie budowania kończy się od razu."""

    def __init__(self, path):
        self.path, self.fh = path, None

    def acquire(self):
        self.fh = open(self.path, "a+")
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            self.fh.close()
            self.fh = None
            return False

    def release(self):
        if self.fh:
            self.fh.close()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_state(work_dir):
    try:
        with open(os.path.join(work_dir, "state.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"sources": {}}


def save_state(work_dir, state):
    tmp = os.path.join(work_dir, "state.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp, os.path.join(work_dir, "state.json"))


def today_warsaw():
    if os.environ.get("RWP_TODAY"):          # nadpisanie daty (testy)
        return os.environ["RWP_TODAY"]
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo("Europe/Warsaw")).strftime("%Y%m%d")
    except Exception:  # brak bazy stref (np. Windows bez tzdata)
        return dt.datetime.now().strftime("%Y%m%d")


# ---------------------------------------------------------------- pobieranie
def download(src, cache_dir, sstate, cfg):
    """Zwraca (ścieżka_do_zip, zmieniono?) albo rzuca wyjątek. Obsługuje 304 Not Modified."""
    url = src["url"]
    if "://" not in url:                      # ścieżka lokalna (przydatne do testów)
        url = "file://" + os.path.abspath(url)
    dest = os.path.join(cache_dir, src["name"] + ".zip")
    headers = {"User-Agent": USER_AGENT}
    if os.path.exists(dest) and url.startswith("http"):
        if sstate.get("etag"):
            headers["If-None-Match"] = sstate["etag"]
        if sstate.get("last_modified"):
            headers["If-Modified-Since"] = sstate["last_modified"]
    limit = cfg["max_download_mb"] * 1024 * 1024
    last_err = None
    for attempt in range(1, cfg["retries"] + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=cfg["timeout_s"]) as r:
                tmp = dest + ".part"
                size = 0
                with open(tmp, "wb") as f:
                    while True:
                        chunk = r.read(1 << 16)
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > limit:
                            raise ValueError(f"plik większy niż {cfg['max_download_mb']} MB")
                        f.write(chunk)
                os.replace(tmp, dest)
                info = r.headers if hasattr(r, "headers") else {}
                sstate["etag"] = info.get("ETag") if info else None
                sstate["last_modified"] = info.get("Last-Modified") if info else None
                return dest, True
        except urllib.error.HTTPError as e:
            if e.code == 304 and os.path.exists(dest):
                return dest, False
            last_err = e
            if 400 <= e.code < 500:
                break                          # błąd klienta — ponawianie nic nie da
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            last_err = e
        if attempt < cfg["retries"]:
            time.sleep(min(30, 3 * 2 ** (attempt - 1)))
    raise RuntimeError(f"pobieranie nie powiodło się: {last_err}")


def check_zip(path):
    """Sprawdza, czy to poprawne archiwum GTFS. Zwraca listę plików .txt."""
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        if bad:
            raise ValueError(f"uszkodzony plik w archiwum: {bad}")
        names = {os.path.basename(n) for n in z.namelist() if n.endswith(".txt")}
    missing = [f for f in REQUIRED if f not in names]
    if missing:
        raise ValueError("brak plików GTFS: " + ", ".join(missing))
    return names


def zip_coverage(path):
    """Szybko odczytuje zakres dat paczki (feed_info, calendar, calendar_dates) bez pełnego przetwarzania."""
    import csv
    import io
    dates = []
    with zipfile.ZipFile(path) as z:
        files = {os.path.basename(n): n for n in z.namelist()}

        def rows(name):
            if name not in files:
                return []
            with z.open(files[name]) as f:
                return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))
        fi = rows("feed_info.txt")
        if fi and fi[0].get("feed_start_date") and fi[0].get("feed_end_date"):
            return fi[0]["feed_start_date"], fi[0]["feed_end_date"]
        for r in rows("calendar.txt"):
            dates += [r["start_date"], r["end_date"]]
        dates += [r["date"] for r in rows("calendar_dates.txt") if r.get("exception_type", "").strip() == "1"]
    return (min(dates), max(dates)) if dates else ("", "")


def extract_txt(path, dest):
    """Rozpakowuje wyłącznie pliki .txt, spłaszczając ścieżki (ochrona przed path traversal)."""
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            base = os.path.basename(info.filename)
            if info.is_dir() or not base.endswith(".txt") or base.startswith("."):
                continue
            with z.open(info) as s, open(os.path.join(dest, base), "wb") as d:
                shutil.copyfileobj(s, d)


# ---------------------------------------------------------------- adresy OSM
def fetch_addresses(cfg):
    """Zwraca ścieżkę do aktualnych adresów (Overpass JSON) albo None. Przy błędzie używa starej kopii."""
    acfg = dict(DEFAULTS["addresses"], **(cfg.get("addresses") or {}))
    if not acfg.get("enabled"):
        return None
    path = os.path.join(cfg["work_dir"], "cache", "addresses.json")
    if "://" not in acfg["url"]:                       # plik lokalny (np. własny eksport)
        return acfg["url"] if os.path.exists(acfg["url"]) else None
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < acfg["max_age_days"] * 86400:
        return path
    s, w, n, e = acfg["bbox"]
    query = (f'[out:json][timeout:{acfg["timeout_s"] - 10}];'
             f'node["addr:housenumber"]({s},{w},{n},{e});out;'
             f'way["addr:housenumber"]({s},{w},{n},{e});out center;')
    try:
        req = urllib.request.Request(acfg["url"], data=urllib.parse.urlencode({"data": query}).encode(),
                                     headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=acfg["timeout_s"]) as r:
            raw = r.read()
        doc = json.loads(raw)
        n_el = len(doc.get("elements", []))
        if n_el < 100:
            raise ValueError(f"podejrzanie mało adresów ({n_el})")
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(raw)
        os.replace(tmp, path)
        log.info("adresy OSM: pobrano %d elementów", n_el)
        return path
    except Exception as e:  # noqa: BLE001
        if os.path.exists(path):
            log.warning("adresy OSM: %s — używam kopii z %s", e,
                        dt.datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m-%d"))
            return path
        log.warning("adresy OSM: %s — buduję bez numerów budynków", e)
        return None


# ---------------------------------------------------------------- mapa OSM
def fetch_map(cfg):
    """Odświeża warstwy mapy. Warstwa, której nie udało się pobrać, zostaje w poprzedniej kopii.
    Zwraca katalog cache, gdy są budynki, inaczej None (strona użyje zabudowy poglądowej)."""
    mcfg = dict(DEFAULTS["map"], **(cfg.get("map") or {}))
    if not mcfg.get("enabled"):
        return None
    cache = os.path.join(cfg["work_dir"], "cache")
    pending = False
    for name, query in osm.queries(mcfg["bbox"], mcfg["timeout_s"] - 10).items():
        path = osm.layer_path(cache, name)
        if os.path.exists(path) and time.time() - os.path.getmtime(path) < mcfg["max_age_days"] * 86400:
            continue
        if pending:
            time.sleep(mcfg["pause_s"])
        pending = True
        for attempt in range(1, cfg["retries"] + 1):
            try:
                req = urllib.request.Request(mcfg["url"], data=urllib.parse.urlencode({"data": query}).encode(),
                                             headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=mcfg["timeout_s"]) as r:
                    raw = r.read()
                doc = json.loads(raw)
                if "error" in (doc.get("remark") or ""):   # przekroczony limit: dane są niepełne
                    raise ValueError(doc["remark"].strip()[:200])
                n_el = len(doc.get("elements", []))
                if n_el < 100:
                    raise ValueError(f"podejrzanie mało elementów ({n_el})")
                tmp = path + ".part"
                with gzip.open(tmp, "wb", compresslevel=6) as f:
                    f.write(raw)
                os.replace(tmp, path)
                log.info("mapa OSM, %s: pobrano %d elementów", name, n_el)
                break
            except Exception as e:  # noqa: BLE001
                if attempt < cfg["retries"]:           # Overpass często chwilowo odpowiada 429/502/504
                    log.info("mapa OSM, %s: %s — ponawiam (%d/%d)", name, e, attempt, cfg["retries"])
                    time.sleep(mcfg["retry_pause_s"] * attempt)
                else:
                    log.warning("mapa OSM, %s: %s — %s", name, e, "używam poprzedniej kopii" if os.path.exists(path) else "brak warstwy, spróbuję przy następnym uruchomieniu")
    return cache if os.path.exists(osm.layer_path(cache, "buildings")) else None


def map_hash(cache):
    h = hashlib.sha256()
    for name in osm.queries((0, 0, 0, 0), 0):
        path = osm.layer_path(cache, name)
        if os.path.exists(path):
            h.update(sha256_file(path).encode())
    return h.hexdigest()


# ---------------------------------------------------------------- build
def code_hash(cfg):
    h = hashlib.sha256()
    for p in (*sources(cfg["template"]), os.path.join(HERE, "prep.py"), os.path.join(HERE, "build.py"), os.path.join(HERE, "osm.py")):
        h.update(sha256_file(p).encode())
    return h.hexdigest()


def build_from(zip_path, cfg, today, addresses=None, map_cache=None):
    """Buduje stronę do pliku tymczasowego w out_dir. Zwraca (tmp_html, statystyki)."""
    os.makedirs(cfg["out_dir"], exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="rwp-") as tmp:
        gtfs = os.path.join(tmp, "gtfs")
        os.makedirs(gtfs)
        extract_txt(zip_path, gtfs)
        data_json = os.path.join(tmp, "data.json")
        stats = prepare(gtfs, data_json, addresses, map_cache)
        problems = []
        if stats["routes"] < cfg["min_routes"]:
            problems.append(f"za mało linii ({stats['routes']})")
        if stats["trips"] < cfg["min_trips"]:
            problems.append(f"za mało kursów ({stats['trips']})")
        if stats["stops"] < cfg["min_stops"]:
            problems.append(f"za mało przystanków ({stats['stops']})")
        if stats["dates"] == 0:
            problems.append("brak dni kursowania w kalendarzu")
        if problems:
            raise ValueError("walidacja danych: " + "; ".join(problems))
        out_tmp = os.path.join(cfg["out_dir"], ".index.html.tmp")
        size = build(data_json, cfg["template"], out_tmp)
        stats["html_bytes"] = size
        stats["covers_today"] = bool(stats["start"]) and stats["start"] <= today <= stats["end"]
        return out_tmp, stats


def archive(zip_path, name, sha, cfg):
    adir = os.path.join(cfg["work_dir"], "archive")
    os.makedirs(adir, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M")
    shutil.copy2(zip_path, os.path.join(adir, f"{stamp}_{name}_{sha[:8]}.zip"))
    files = sorted(f for f in os.listdir(adir) if f.endswith(".zip"))
    for old in files[:-cfg["keep_archives"]] if cfg["keep_archives"] > 0 else []:
        os.remove(os.path.join(adir, old))


def run_hook(cmd, cfg, info):
    env = dict(os.environ, RWP_OUT_DIR=cfg["out_dir"], RWP_INDEX=os.path.join(cfg["out_dir"], "index.html"),
               RWP_SOURCE=info["source"], RWP_FEED_VERSION=str(info.get("version", "")))
    log.info("post_build: %s", cmd)
    r = subprocess.run(cmd, shell=True, cwd=HERE, env=env, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        log.error("post_build zakończył się kodem %s: %s", r.returncode, (r.stderr or r.stdout).strip()[-800:])
        return False
    return True


# ---------------------------------------------------------------- główna logika
def run(cfg, force=False):
    work, cache = cfg["work_dir"], os.path.join(cfg["work_dir"], "cache")
    os.makedirs(cache, exist_ok=True)
    state = load_state(work)
    today = today_warsaw()

    # 1. pobierz i sprawdź wszystkie źródła po kolei, aż znajdziesz paczkę obejmującą dziś
    candidates = []
    for src in cfg["sources"]:
        sstate = state["sources"].setdefault(src["name"], {})
        try:
            path, changed = download(src, cache, sstate, cfg)
            check_zip(path)
            sha = sha256_file(path)
            sstate.update(sha=sha, checked=dt.datetime.now().isoformat(timespec="seconds"), error=None)
            start, end = zip_coverage(path)
            log.info("%s: %s (%s, rozkład %s–%s)", src["name"], "nowa paczka" if changed else "bez zmian (304)",
                     sha[:12], start or "?", end or "?")
            candidates.append((src, path, sha))
            if start and start <= today <= end:
                break                          # mamy aktualną paczkę — kolejnych źródeł nie trzeba pobierać
        except Exception as e:  # noqa: BLE001 — chcemy spróbować kolejnego źródła
            sstate["error"] = str(e)
            log.warning("%s: %s", src["name"], e)
    save_state(work, state)
    if not candidates:
        log.error("żadne źródło GTFS nie jest dostępne — zostaje poprzednia wersja strony")
        return 1

    # 2. zbuduj z pierwszego kandydata, który przejdzie walidację i obejmuje dziś;
    #    jeśli żaden nie obejmuje dzisiejszej daty, użyj pierwszego poprawnego (z ostrzeżeniem)
    addresses = fetch_addresses(cfg)
    map_cache = fetch_map(cfg)
    ch = code_hash(cfg) + (":" + sha256_file(addresses)[:16] if addresses else "") + (":" + map_hash(map_cache)[:16] if map_cache else "")
    index = os.path.join(cfg["out_dir"], "index.html")
    fallback, current_stale = None, False
    for src, path, sha in candidates:
        key = f"{src['name']}:{sha}:{ch}"
        if not force and key == state.get("last_build_key") and os.path.exists(index):
            last = state.get("last_build", {})
            if last.get("start", "") <= today <= last.get("end", ""):
                log.info("bez zmian — strona aktualna (%s, %s)", src["name"], last.get("version", ""))
                return 0
            current_stale = True               # opublikowana paczka jest nieaktualna — szukaj dalej
            continue
        try:
            tmp_html, stats = build_from(path, cfg, today, addresses, map_cache)
        except Exception as e:  # noqa: BLE001
            log.warning("%s: build nieudany: %s", src["name"], e)
            continue
        if stats["covers_today"]:
            return publish(tmp_html, stats, src, path, sha, key, state, cfg)
        log.warning("%s: rozkład %s–%s nie obejmuje dziś (%s), sprawdzam kolejne źródło",
                    src["name"], stats["start"], stats["end"], today)
        if fallback is None:
            keep = tmp_html + "." + src["name"]
            os.replace(tmp_html, keep)
            fallback = (keep, stats, src, path, sha, key)
        else:
            os.remove(tmp_html)
    if fallback:
        log.warning("brak paczki obejmującej dziś — publikuję %s, strona użyje rozkładu wzorcowego",
                    fallback[2]["name"])
        return publish(*fallback, state, cfg)
    if current_stale:
        log.warning("brak nowszej paczki — zostaje opublikowana wersja (rozkład wzorcowy dla dzisiejszej daty)")
        return 0
    log.error("żadna paczka nie przeszła walidacji — zostaje poprzednia wersja strony")
    return 2


def publish(tmp_html, stats, src, path, sha, key, state, cfg):
    index = os.path.join(cfg["out_dir"], "index.html")
    os.replace(tmp_html, index)                      # atomowa podmiana
    for f in os.listdir(cfg["out_dir"]):             # posprzątaj resztki po fallbacku
        if f.startswith(".index.html.tmp"):
            os.remove(os.path.join(cfg["out_dir"], f))
    info = dict(stats, source=src["name"], url=src["url"], sha256=sha,
                built=dt.datetime.now().isoformat(timespec="seconds"))
    with open(os.path.join(cfg["out_dir"], "build-info.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)
    archive(path, src["name"], sha, cfg)
    state["last_build_key"], state["last_build"] = key, info
    save_state(cfg["work_dir"], state)
    log.info("zbudowano z %s: %d linii, %d kursów, %d adresów, %d budynków, rozkład %s–%s, %.0f KB",
             src["name"], stats["routes"], stats["trips"], stats.get("addresses", 0), stats.get("buildings", 0), stats["start"], stats["end"],
             stats["html_bytes"] / 1024)
    if cfg.get("post_build") and not run_hook(cfg["post_build"], cfg, info):
        return 3
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=os.path.join(HERE, "pipeline.json"))
    ap.add_argument("--force", action="store_true", help="zbuduj nawet bez zmian")
    ap.add_argument("--verbose", "-v", action="store_true", help="wypisuj postęp na stderr")
    args = ap.parse_args()
    cfg = load_config(args.config)
    setup_logging(cfg["work_dir"], args.verbose)
    lock = Lock(os.path.join(cfg["work_dir"], ".lock"))
    if not lock.acquire():
        log.info("inne uruchomienie jest w toku — pomijam")
        return 0
    try:
        return run(cfg, force=args.force)
    except Exception:  # noqa: BLE001
        log.exception("nieoczekiwany błąd")
        return 2
    finally:
        lock.release()


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Model wysokości terenu (DEM) dla mapy: siatka wysokości nad obszarem sieci.

Źródło: API elevation Open-Meteo (Copernicus DEM GLO-90, ok. 90 m), bez klucza, do 100 punktów na zapytanie.
Siatka jest regularna w stopniach, więc po rzutowaniu na lokalny układ metryczny też jest regularna.

Plik cache (work/cache/dem.json.gz): {"bbox": [płd, zach, płn, wsch], "nx", "ny", "h": [m, wierszami od południa]}.
"""
import gzip
import json
import math
import os
import time
import urllib.parse
import urllib.request

BATCH = 100


def grid_size(bbox, step_m):
    s, w, n, e = bbox
    lat0 = (s + n) / 2
    ny = max(2, round((n - s) * 110574 / step_m) + 1)
    nx = max(2, round((e - w) * 111320 * math.cos(math.radians(lat0)) / step_m) + 1)
    return nx, ny


def grid_points(bbox, nx, ny):
    s, w, n, e = bbox
    return [(s + (n - s) * j / (ny - 1), w + (e - w) * i / (nx - 1)) for j in range(ny) for i in range(nx)]


def fetch(bbox, step_m, url, user_agent, pause_s=1.0, retries=4, timeout=60, log=None):
    """Pobiera siatkę wysokości. Zwraca słownik gotowy do zapisu albo zgłasza wyjątek."""
    nx, ny = grid_size(bbox, step_m)
    pts = grid_points(bbox, nx, ny)
    h = []
    for b in range(0, len(pts), BATCH):
        chunk = pts[b:b + BATCH]
        q = urllib.parse.urlencode({'latitude': ','.join(f'{la:.5f}' for la, _ in chunk),
                                    'longitude': ','.join(f'{lo:.5f}' for _, lo in chunk)})
        for attempt in range(1, retries + 1):
            try:
                req = urllib.request.Request(url + '?' + q, headers={'User-Agent': user_agent})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    vals = json.loads(r.read())['elevation']
                if len(vals) != len(chunk):
                    raise ValueError(f'oczekiwano {len(chunk)} wysokości, jest {len(vals)}')
                h += [round(float(v), 1) if v is not None else None for v in vals]
                break
            except Exception as e:  # noqa: BLE001
                if attempt == retries:
                    raise
                limited = getattr(e, 'code', None) == 429      # limit minutowy: zapytanie o 100 punktów liczy się jak 10
                if log:
                    log.info('wysokości terenu: %s — ponawiam (%d/%d)', e, attempt, retries)
                time.sleep(65 if limited else pause_s * 20 * attempt)
        time.sleep(pause_s)
    fill(h)
    return {'bbox': list(bbox), 'nx': nx, 'ny': ny, 'h': h, 'source': 'Open-Meteo Elevation API (Copernicus DEM GLO-90)'}


def fill(h):
    """Braki (None, np. nad wodą poza zasięgiem) zastępuje średnią znanych wartości."""
    known = [v for v in h if v is not None]
    avg = sum(known) / len(known) if known else 0
    for i, v in enumerate(h):
        if v is None:
            h[i] = avg


def load(path):
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        return json.load(f)


def save(doc, path):
    tmp = path + '.part'
    with gzip.open(tmp, 'wt', encoding='utf-8') as f:
        json.dump(doc, f, separators=(',', ':'))
    os.replace(tmp, path)


def compact(doc, proj, origin_latlon):
    """Siatka w lokalnym układzie strony: początek, krok, rozmiar i wysokości [dm] względem punktu odniesienia
    (Rynek = 0), żeby podpisy i kamera zostały blisko zera."""
    s, w, n, e = doc['bbox']
    nx, ny, h = doc['nx'], doc['ny'], doc['h']
    x0, y0 = proj(s, w)
    x1, y1 = proj(n, e)
    dx, dy = (x1 - x0) / (nx - 1), (y1 - y0) / (ny - 1)
    ox, oy = proj(*origin_latlon)
    fi, fj = (ox - x0) / dx, (oy - y0) / dy
    i, j = min(max(int(fi), 0), nx - 2), min(max(int(fj), 0), ny - 2)
    u, v = fi - i, fj - j
    at = lambda a, b: h[b * nx + a]
    base = (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v
    return {'x0': round(x0, 1), 'y0': round(y0, 1), 'dx': round(dx, 3), 'dy': round(dy, 3), 'nx': nx, 'ny': ny,
            'base': round(base, 1), 'h': [round((v - base) * 10) for v in h]}

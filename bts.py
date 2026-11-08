#!/usr/bin/env python3
"""Stacje bazowe telefonii komórkowej z wykazu pozwoleń radiowych UKE (GSM, UMTS, LTE, 5G NR, GSM-R).

UKE publikuje co kilka tygodni arkusze xlsx (jeden na system i pasmo) ze współrzędnymi stacji.
Moduł pobiera wszystkie arkusze ze strony wykazu, wybiera stacje z obszaru mapy i grupuje je po lokalizacji:
jedna lokalizacja (maszt, dach) = lista operatorów z systemami i pasmami.

Użycie jako skrypt:  python3 bts.py [bts.json.gz]
"""
import gzip
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

SOURCE = 'UKE, wykaz pozwoleń radiowych'
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
OPERATORS = [('orange', 'Orange'), ('p4', 'Play'), ('play', 'Play'), ('t-mobile', 'T-Mobile'), ('polkomtel', 'Plus'),
             ('aero2', 'Plus'), ('linie kolejowe', 'PKP PLK'), ('plk', 'PKP PLK'), ('cyfrowy polsat', 'Plus')]
SKIP = ('sieci_prywatne',)               # sieci przemysłowe 3,8–4,2 GHz: nie telefonia publiczna


def operator(name):
    low = (name or '').lower()
    for key, short in OPERATORS:
        if key in low:
            return short
    return (name or '?').split(' Sp.')[0].split(' S.A.')[0].strip() or '?'


def tech(filename):
    """'lte800_-_stan_na_2026-10-26.xlsx' -> 'LTE800', 'gsm-r_...' -> 'GSM-R'."""
    base = filename.rsplit('/', 1)[-1].split('_-_')[0].split('_stan')[0]
    return base.upper()


def dms(v):
    """'20E47'02"' albo '52N04'06"' -> stopnie dziesiętne."""
    m = re.match(r"\s*(\d+)\s*([NSEW])\s*(\d+)\s*'\s*(\d+(?:[.,]\d+)?)", str(v or ''))
    if not m:
        return None
    d = int(m.group(1)) + int(m.group(3)) / 60 + float(m.group(4).replace(',', '.')) / 3600
    return -d if m.group(2) in 'SW' else d


def read_xlsx(data):
    """Pierwszy arkusz xlsx -> lista wierszy (listy tekstów). Wystarcza biblioteka standardowa."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(NS + 'si'):
                shared.append(''.join(t.text or '' for t in si.iter(NS + 't')))
        sheet = next(n for n in sorted(z.namelist()) if n.startswith('xl/worksheets/sheet'))
        rows = []
        for row in ET.fromstring(z.read(sheet)).iter(NS + 'row'):
            out = {}
            for c in row.iter(NS + 'c'):
                ref = re.match(r'([A-Z]+)', c.get('r', 'A'))
                col = 0
                for ch in ref.group(1):
                    col = col * 26 + ord(ch) - 64
                v = c.find(NS + 'v')
                if c.get('t') == 's' and v is not None:
                    val = shared[int(v.text)]
                elif c.get('t') == 'inlineStr':
                    val = ''.join(t.text or '' for t in c.iter(NS + 't'))
                else:
                    val = v.text if v is not None else ''
                out[col - 1] = val
            rows.append([out.get(i, '') for i in range(max(out) + 1)] if out else [])
        return rows


def _get(url, ua, timeout):
    req = urllib.request.Request(url, headers={'User-Agent': ua})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def links(page_url, html):
    found = re.findall(r'href="([^"]+\.xlsx)"', html)
    return sorted({urllib.parse.urljoin(page_url, h) for h in found if not any(s in h for s in SKIP)})


def collect(sheets, bbox):
    """[(nazwa_pliku, wiersze)] -> {'sites': [...]} dla obszaru bbox."""
    s, w, n, e = bbox
    sites = {}
    for fname, rows in sheets:
        if not rows:
            continue
        head = [h.strip().lower() for h in rows[0]]
        col = lambda *keys: next((i for i, h in enumerate(head) if all(k in h for k in keys)), None)
        c_op, c_lon, c_lat = col('operatora'), col('dł', 'geogr'), col('szer', 'geogr')
        c_town, c_loc = col('miejscowość'), col('lokalizacja')
        if None in (c_op, c_lon, c_lat):
            continue
        t = tech(fname)
        for r in rows[1:]:
            if len(r) <= max(c_op, c_lon, c_lat):
                continue
            lat, lon = dms(r[c_lat]), dms(r[c_lon])
            if lat is None or lon is None or not (s <= lat <= n and w <= lon <= e):
                continue
            key = (round(lat, 4), round(lon, 4))
            site = sites.setdefault(key, {'lat': key[0], 'lon': key[1], 'loc': '', 'tx': {}})
            if not site['loc']:
                town = r[c_town] if c_town is not None and c_town < len(r) else ''
                loc = r[c_loc] if c_loc is not None and c_loc < len(r) else ''
                site['loc'] = ', '.join(x.strip() for x in (loc, town) if x and x.strip())
            site['tx'].setdefault(operator(r[c_op]), set()).add(t)
    out = []
    for key in sorted(sites):
        st = sites[key]
        out.append({'lat': st['lat'], 'lon': st['lon'], 'loc': st['loc'],
                    'tx': [[op, sorted(ts)] for op, ts in sorted(st['tx'].items())]})
    return {'bbox': list(bbox), 'sites': out}


def fetch(page_url, bbox, ua, timeout=60, log=None, pause_s=0.5):
    html = _get(page_url, ua, timeout).decode('utf-8', 'replace')
    urls = links(page_url, html)
    if not urls:
        raise ValueError('brak arkuszy xlsx na stronie wykazu')
    sheets = []
    for u in urls:
        try:
            sheets.append((u, read_xlsx(_get(u, ua, timeout))))
        except Exception as ex:  # noqa: BLE001 — jeden zły arkusz nie przekreśla reszty
            if log:
                log.warning('UKE %s: %s', u.rsplit('/', 1)[-1], ex)
        time.sleep(pause_s)
    doc = collect(sheets, bbox)
    if not doc['sites']:
        raise ValueError('żadnej stacji w obszarze mapy')
    return doc


def save(doc, path):
    with gzip.open(path + '.part', 'wt', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    import os
    os.replace(path + '.part', path)


def load(path):
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        return json.load(f)


def compact(doc, proj):
    """Do danych strony: {'ops': [operatorzy], 's': [[x, y, lokalizacja, [[op, 'LTE800 5G3600 …'], …]], …]}."""
    ops = sorted({op for st in doc['sites'] for op, _ in st['tx']})
    idx = {op: i for i, op in enumerate(ops)}
    s = []
    for st in doc['sites']:
        x, y = proj(st['lat'], st['lon'])
        s.append([round(x, 1), round(y, 1), st['loc'], [[idx[op], ' '.join(ts)] for op, ts in st['tx']]])
    return {'ops': ops, 's': s}


if __name__ == '__main__':
    d = fetch('https://bip.uke.gov.pl/pozwolenia-radiowe/wykaz-pozwolen-radiowych-tresci/stacje-gsm-umts-lte-5gnr-oraz-cdma,12,0.html',
              [49.90, 21.78, 50.14, 22.26], 'rzeszow-w-pikselach/1.0', log=None)
    save(d, sys.argv[1] if len(sys.argv) > 1 else 'bts.json.gz')
    print(len(d['sites']), 'lokalizacji')

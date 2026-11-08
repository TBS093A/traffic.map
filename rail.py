#!/usr/bin/env python3
"""Pociągi: kursy z ogólnopolskiego GTFS kolei (https://mkuran.pl/gtfs/polish_trains.zip, dane PKP PLK)
przycięte do obszaru mapy i dopisane do katalogu GTFS autobusów. Dalej prep.py traktuje je jak zwykłe linie,
więc rozkłady stacji, planer i porównanie rozkładów działają też dla pociągów.

Identyfikatory kolejowe dostają przedrostek "R:", żeby nie zderzyły się z identyfikatorami ZTM.
Z kursu zostaje najdłuższy ciąg kolejnych stacji w obszarze mapy (co najmniej dwie) i kawałek przebiegu
między pierwszą a ostatnią z nich.

Użycie jako skrypt:  python3 rail.py <katalog_gtfs/> <polish_trains.zip> [płd zach płn wsch]
"""
import collections
import csv
import io
import math
import os
import sys
import zipfile

PREFIX = 'R:'
SOURCE = 'PKP PLK (GTFS: mkuran.pl)'


def is_rail(route_type):
    """GTFS route_type: 2 = kolej, 100–117 = rozszerzone typy kolejowe."""
    try:
        t = int(route_type)
    except (TypeError, ValueError):
        return False
    return t == 2 or 100 <= t <= 117


def _rows(z, name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig', newline=''))


def _inside(lat, lon, bbox):
    s, w, n, e = bbox
    return s <= lat <= n and w <= lon <= e


def _longest_run(rows, inbox):
    """Najdłuższy ciąg kolejnych postojów w obszarze (rows posortowane po stop_sequence)."""
    best, cur = [], []
    for r in rows:
        if r['stop_id'] in inbox:
            cur.append(r)
            if len(cur) > len(best):
                best = list(cur)
        else:
            cur = []
    return best


def _nearest(pts, lat, lon, start=0):
    """Indeks punktu przebiegu najbliższego (lat, lon), szukając od start."""
    k = math.cos(math.radians(lat))
    best, bi = 1e18, start
    for i in range(start, len(pts)):
        d = (pts[i][0] - lat) ** 2 + ((pts[i][1] - lon) * k) ** 2
        if d < best:
            best, bi = d, i
    return bi


def extract(rail_zip, bbox):
    """Czyta paczkę kolejową, zwraca słownik plików GTFS (nazwa -> lista wierszy) dla obszaru bbox."""
    with zipfile.ZipFile(rail_zip) as z:
        names = {os.path.basename(n): n for n in z.namelist()}
        rd = lambda name: _rows(z, names[name]) if name in names else iter(())

        stops = {}
        for s in rd('stops.txt'):
            if s.get('location_type', '0') not in ('', '0'):
                continue
            try:
                lat, lon = float(s['stop_lat']), float(s['stop_lon'])
            except (KeyError, ValueError):
                continue
            if _inside(lat, lon, bbox):
                stops[s['stop_id']] = s
        routes = {r['route_id']: r for r in rd('routes.txt') if is_rail(r.get('route_type'))}
        trips = {t['trip_id']: t for t in rd('trips.txt') if t['route_id'] in routes and t.get('shape_id')}

        # kursy z co najmniej dwoma postojami w obszarze; potem pełne listy postojów tylko dla nich
        hits = collections.Counter(r['trip_id'] for r in rd('stop_times.txt') if r['stop_id'] in stops and r['trip_id'] in trips)
        keep = {t for t, n in hits.items() if n >= 2}
        st = collections.defaultdict(list)
        for r in rd('stop_times.txt'):
            if r['trip_id'] in keep:
                st[r['trip_id']].append(r)

        runs = {}
        for tid, rows in st.items():
            rows.sort(key=lambda r: int(r['stop_sequence']))
            run = _longest_run(rows, stops)
            if len(run) >= 2:
                runs[tid] = run
        shape_ids = {trips[t]['shape_id'] for t in runs}
        raw = collections.defaultdict(list)
        for r in rd('shapes.txt'):
            if r['shape_id'] in shape_ids:
                raw[r['shape_id']].append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
        shapes = {k: [(la, lo) for _, la, lo in sorted(v)] for k, v in raw.items()}

        out = {n: [] for n in ('routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt', 'shapes.txt', 'calendar_dates.txt', 'calendar.txt')}
        clipped, used_stops, used_routes, used_services = {}, set(), set(), set()
        for tid, run in runs.items():
            t = trips[tid]
            pts = shapes.get(t['shape_id'])
            if not pts or len(pts) < 2:
                continue
            a, b = stops[run[0]['stop_id']], stops[run[-1]['stop_id']]
            i0 = _nearest(pts, float(a['stop_lat']), float(a['stop_lon']))
            i1 = _nearest(pts, float(b['stop_lat']), float(b['stop_lon']), i0)
            if i1 <= i0:
                continue
            key = (t['shape_id'], i0, i1)
            if key not in clipped:
                sid = f'{PREFIX}{t["shape_id"]}:{i0}:{i1}'
                clipped[key] = sid
                for k, (la, lo) in enumerate(pts[i0:i1 + 1]):
                    out['shapes.txt'].append({'shape_id': sid, 'shape_pt_lat': la, 'shape_pt_lon': lo, 'shape_pt_sequence': k})
            out['trips.txt'].append({'route_id': PREFIX + t['route_id'], 'service_id': PREFIX + t['service_id'],
                                     'trip_id': PREFIX + tid, 'shape_id': clipped[key],
                                     'trip_headsign': t.get('trip_headsign', ''),
                                     # numer i nazwa pociągu (np. "5338/9 Bystrzyca") w miejscu brygady autobusu
                                     'brigade': (t.get('trip_short_name') or '').strip()})
            for k, r in enumerate(run):
                out['stop_times.txt'].append({'trip_id': PREFIX + tid, 'arrival_time': r['arrival_time'] or r['departure_time'],
                                              'departure_time': r['departure_time'] or r['arrival_time'],
                                              'stop_id': PREFIX + r['stop_id'], 'stop_sequence': k})
                used_stops.add(r['stop_id'])
            used_routes.add(t['route_id'])
            used_services.add(t['service_id'])

        for sid in sorted(used_stops):
            s = stops[sid]
            out['stops.txt'].append({'stop_id': PREFIX + sid, 'stop_name': s['stop_name'], 'stop_lat': s['stop_lat'],
                                     'stop_lon': s['stop_lon'], 'stop_code': s.get('platform_code', '') or ''})
        for rid in sorted(used_routes):
            r = routes[rid]
            out['routes.txt'].append({'route_id': PREFIX + rid, 'route_short_name': r.get('route_short_name') or rid,
                                      'route_long_name': r.get('route_long_name', ''), 'route_type': '2',
                                      'route_color': r.get('route_color', '')})
        for r in rd('calendar_dates.txt'):
            if r['service_id'] in used_services:
                out['calendar_dates.txt'].append({'service_id': PREFIX + r['service_id'], 'date': r['date'],
                                                  'exception_type': r['exception_type']})
        for r in rd('calendar.txt'):
            if r['service_id'] in used_services:
                out['calendar.txt'].append(dict(r, service_id=PREFIX + r['service_id']))
    return out


def append(gtfs_dir, name, rows):
    """Dopisuje wiersze do pliku GTFS; brakujące kolumny dochodzą do nagłówka (plik jest wtedy przepisany)."""
    if not rows:
        return
    path = os.path.join(gtfs_dir, name)
    old_rows, fields = [], []
    if os.path.exists(path):
        with open(path, encoding='utf-8-sig', newline='') as f:
            rdr = csv.DictReader(f)
            fields = list(rdr.fieldnames or [])
            old_rows = list(rdr)
    for r in rows:
        for k in r:
            if k not in fields:
                fields.append(k)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        w.writeheader()
        w.writerows(old_rows)
        w.writerows(rows)


def merge(gtfs_dir, rail_zip, bbox):
    """Dopisuje pociągi z obszaru bbox do katalogu GTFS. Zwraca statystyki."""
    out = extract(rail_zip, bbox)
    for name, rows in out.items():
        append(gtfs_dir, name, rows)
    return {'rail_trips': len(out['trips.txt']), 'rail_stations': len({s['stop_name'] for s in out['stops.txt']}),
            'rail_routes': len(out['routes.txt'])}


if __name__ == '__main__':
    bb = [float(x) for x in sys.argv[3:7]] if len(sys.argv) >= 7 else [49.90, 21.78, 50.14, 22.26]
    print(merge(sys.argv[1], sys.argv[2], bb))

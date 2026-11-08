#!/usr/bin/env python3
"""Przygotowanie danych GTFS (ZTM Rzeszów) dla mapy pixel-art.

Użycie jako skrypt:  python3 prep.py <katalog_gtfs/> [data.json]
Użycie jako moduł:   from prep import prepare; stats = prepare('gtfs/', 'data.json')

Współrzędne są rzutowane na lokalny układ metryczny (x = wschód, y = północ)
względem Rynku w Rzeszowie.
"""
import collections
import colorsys
import csv
import datetime as dt
import json
import math
import os
import sys

from rail import SOURCE as RAIL_SOURCE, is_rail

LAT0, LON0 = 50.0375, 22.0049          # Rynek
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110574
REQUIRED = ['routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt', 'shapes.txt']


def proj(lat, lon):
    return ((lon - LON0) * KX, (lat - LAT0) * KY)


def tsec(s):
    h, m, x = s.strip().split(':')
    return int(h) * 3600 + int(m) * 60 + int(x)


def dp(pts, eps):
    """Upraszczanie linii Douglasa-Peuckera (iteracyjnie)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
                d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def cumlen(pts):
    c = [0.0]
    for a, b in zip(pts, pts[1:]):
        c.append(c[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    return c


def service_dates(src, rd):
    """Mapa data -> lista service_id z calendar.txt (jeśli jest) i calendar_dates.txt."""
    dates = collections.defaultdict(set)
    if os.path.exists(os.path.join(src, 'calendar.txt')):
        days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        for r in rd('calendar.txt'):
            d0 = dt.datetime.strptime(r['start_date'], '%Y%m%d').date()
            d1 = dt.datetime.strptime(r['end_date'], '%Y%m%d').date()
            if (d1 - d0).days > 400:          # zabezpieczenie przed absurdalnym zakresem
                d1 = d0 + dt.timedelta(days=400)
            d = d0
            while d <= d1:
                if r.get(days[d.weekday()], '0').strip() == '1':
                    dates[d.strftime('%Y%m%d')].add(r['service_id'])
                d += dt.timedelta(days=1)
    if os.path.exists(os.path.join(src, 'calendar_dates.txt')):
        for r in rd('calendar_dates.txt'):
            if r['exception_type'].strip() == '1':
                dates[r['date']].add(r['service_id'])
            elif r['exception_type'].strip() == '2':
                dates[r['date']].discard(r['service_id'])
    return {k: sorted(v) for k, v in sorted(dates.items()) if v}


def load_addresses(path, stops, radius=1500):
    """Punkty adresowe z odpowiedzi Overpass (JSON) -> [[ulica, miejscowość, "n1|n2|..", [x1,y1,x2,y2,..]], ..].
    Zostają tylko adresy w promieniu `radius` m od jakiegokolwiek przystanku."""
    with open(path, encoding='utf-8') as f:
        elements = json.load(f).get('elements', [])
    cell = radius
    grid = collections.defaultdict(list)
    for x, y, *_ in stops:
        grid[(math.floor(x / cell), math.floor(y / cell))].append((x, y))

    def near(x, y):
        gx, gy = math.floor(x / cell), math.floor(y / cell)
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for sx, sy in grid.get((gx + i, gy + j), ()):
                    if (sx - x) ** 2 + (sy - y) ** 2 <= radius * radius:
                        return True
        return False
    streets = collections.defaultdict(dict)
    for e in elements:
        t = e.get('tags') or {}
        num = (t.get('addr:housenumber') or '').strip()
        street = (t.get('addr:street') or t.get('addr:place') or '').strip()
        if not num or not street:
            continue
        city = (t.get('addr:city') or t.get('addr:place') or '').strip()
        if 'lat' in e:
            lat, lon = e['lat'], e['lon']
        elif 'center' in e:
            lat, lon = e['center']['lat'], e['center']['lon']
        else:
            continue
        x, y = proj(lat, lon)
        if not near(x, y):
            continue
        for n in num.replace(',', ';').split(';'):        # "12;14" -> dwa numery
            n = n.strip()
            if n:
                streets[(street, city)].setdefault(n.lower(), (round(x), round(y)))
    out = []
    for (street, city), nums in sorted(streets.items()):
        keys = sorted(nums, key=lambda n: (int(''.join(c for c in n if c.isdigit())[:6] or 0), n))
        flat = []
        for k in keys:
            flat += nums[k]
        out.append([street, city, '|'.join(keys), flat])
    return out


def prepare(src, out, addresses=None, map_cache=None, dem_path=None, bts_path=None):
    """Czyta GTFS z katalogu src (opcjonalnie adresy i warstwy mapy OSM), zapisuje kompaktowy JSON do out."""
    src = os.path.join(src, '')

    def rd(name):
        with open(src + name, encoding='utf-8-sig', newline='') as f:
            return list(csv.DictReader(f))

    missing = [f for f in REQUIRED if not os.path.exists(src + f)]
    if missing:
        raise ValueError('brak plików GTFS: ' + ', '.join(missing))

    # ---------- linie ----------
    routes = rd('routes.txt')

    def rkey(r):
        n = r['route_short_name'] or r['route_id']
        num = ''.join(c for c in n if c.isdigit())
        return (0 if n[:1].isdigit() else 1, int(num) if num else 0, n)
    routes.sort(key=rkey)
    route_idx = {r['route_id']: i for i, r in enumerate(routes)}
    golden = 0.61803398875
    out_routes = []
    for i, r in enumerate(routes):
        rr, gg, bb = colorsys.hls_to_rgb((i * golden) % 1.0, 0.55, 0.85)
        c = [round(rr * 255), round(gg * 255), round(bb * 255)]
        o = {'n': r['route_short_name'] or r['route_id'], 'name': r.get('route_long_name', ''), 'c': c}
        if is_rail(r.get('route_type')):        # pociąg (rail.py): kolor przewoźnika, tryb 1
            o['m'] = 1
            rc = (r.get('route_color') or '').strip().lstrip('#')
            if len(rc) == 6:
                o['c'] = [int(rc[k:k + 2], 16) for k in (0, 2, 4)]
        out_routes.append(o)

    # ---------- przystanki ----------
    stop_idx, out_stops, stop_street = {}, [], []
    for s in rd('stops.txt'):
        try:
            x, y = proj(float(s['stop_lat']), float(s['stop_lon']))
        except (ValueError, KeyError):
            continue
        stop_idx[s['stop_id']] = len(out_stops)
        street = (s.get('street_name') or '').strip()
        out_stops.append([round(x, 1), round(y, 1), s['stop_name'], s.get('stop_code', '') or '', street])
        stop_street.append(street)

    # ---------- trasy ----------
    raw = collections.defaultdict(list)
    for r in rd('shapes.txt'):
        raw[r['shape_id']].append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
    # w kształtach tras przy każdym przystanku jest punkt dokładnie na słupku, odsunięty od osi jezdni;
    # autobus wjeżdżałby w nim w "zatokę", a wiata brałaby z niego krzywy kierunek
    stop_cells = collections.defaultdict(list)
    for sx, sy, *_ in out_stops:
        stop_cells[(math.floor(sx / 10), math.floor(sy / 10))].append((sx, sy))

    def on_stop(p):
        cx, cy = math.floor(p[0] / 10), math.floor(p[1] / 10)
        return any(math.hypot(p[0] - sx, p[1] - sy) < 1.5 for i in (-1, 0, 1) for j in (-1, 0, 1) for sx, sy in stop_cells.get((cx + i, cy + j), ()))

    def drop_stop_spikes(pts):
        out = pts[:1]
        for k in range(1, len(pts) - 1):
            a, p, b = out[-1], pts[k], pts[k + 1]
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dy)
            if on_stop(p) and 0 < L < 400 and abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L > .8:
                continue
            out.append(p)
        return out + pts[-1:]

    shape_pts = {}
    for k, v in raw.items():
        v.sort()
        pts = drop_stop_spikes([proj(la, lo) for _, la, lo in v])
        clean = [pts[0]]
        for p in pts[1:]:
            if math.hypot(p[0] - clean[-1][0], p[1] - clean[-1][1]) > 0.05:
                clean.append(p)
        if len(clean) >= 2:
            shape_pts[k] = dp(clean, 1.2)
    shape_cum = {k: cumlen(v) for k, v in shape_pts.items()}

    def project_stops(sid, stop_list):
        """Monotoniczne rzutowanie kolejnych przystanków na trasę -> odległość wzdłuż trasy."""
        pts, cum = shape_pts[sid], shape_cum[sid]
        n = len(pts) - 1
        res, seg = [], 0
        for si in stop_list:
            sx, sy = out_stops[si][0], out_stops[si][1]

            def dseg(i):
                ax, ay = pts[i]
                bx, by = pts[i + 1]
                dx, dy = bx - ax, by - ay
                L2 = dx * dx + dy * dy
                t = 0 if L2 == 0 else max(0, min(1, ((sx - ax) * dx + (sy - ay) * dy) / L2))
                return math.hypot(sx - ax - t * dx, sy - ay - t * dy), cum[i] + t * math.sqrt(L2)
            found = None
            for i in range(seg, n):
                if dseg(i)[0] < 30:
                    j = i
                    while j + 1 < n and dseg(j + 1)[0] < dseg(j)[0]:
                        j += 1
                    found = j
                    break
            if found is None:
                best = 1e18
                for i in range(seg, n):
                    d = dseg(i)[0]
                    if d < best:
                        best, found = d, i
            if found is None:
                found = n - 1
            along = dseg(found)[1]
            if res and along < res[-1]:
                along = res[-1]
            res.append(along)
            seg = found
        return res

    # ---------- kursy ----------
    trip_info = {t['trip_id']: t for t in rd('trips.txt')}
    st = collections.defaultdict(list)
    for r in rd('stop_times.txt'):
        if r['stop_id'] not in stop_idx:
            continue
        arr = r['arrival_time'] or r['departure_time']
        dep = r['departure_time'] or r['arrival_time']
        if not arr:
            continue
        st[r['trip_id']].append((int(r['stop_sequence']), r['stop_id'], tsec(arr), tsec(dep)))

    services, service_idx, heads, head_idx = [], {}, [], {}
    patterns, pattern_idx, shape_list, shape_li = [], {}, [], {}
    out_trips, skipped = [], 0
    for tid, rows in st.items():
        t = trip_info.get(tid)
        if not t or t.get('shape_id') not in shape_pts or t['route_id'] not in route_idx or len(rows) < 2:
            skipped += 1
            continue
        rows.sort()
        sl = tuple(stop_idx[r[1]] for r in rows)
        sid = t['shape_id']
        if sid not in shape_li:
            shape_li[sid] = len(shape_list)
            shape_list.append(sid)
        pk = (sid, sl)
        if pk not in pattern_idx:
            pattern_idx[pk] = len(patterns)
            patterns.append([shape_li[sid], list(sl), [round(d) for d in project_stops(sid, sl)]])
        sv = t['service_id']
        if sv not in service_idx:
            service_idx[sv] = len(services)
            services.append(sv)
        h = t.get('trip_headsign', '') or ''
        if h not in head_idx:
            head_idx[h] = len(heads)
            heads.append(h)
        times = []
        for r in rows:
            times += [r[2], r[3]]
        deltas = [b - a for a, b in zip(times, times[1:])]
        out_trips.append([route_idx[t['route_id']], service_idx[sv], pattern_idx[pk], head_idx[h],
                          t.get('brigade', '') or '', tid, times[0], deltas])
    out_trips.sort(key=lambda x: x[6])
    # stacje kolejowe: słupki, na których stają pociągi, dostają znacznik trybu (6. pole)
    for t in out_trips:
        if out_routes[t[0]].get('m') == 1:
            for si in patterns[t[2]][1]:
                if len(out_stops[si]) == 5:
                    out_stops[si].append(1)

    out_shapes = []
    for sid in shape_list:
        flat = []
        for x, y in shape_pts[sid]:
            flat += [round(x, 1), round(y, 1)]
        out_shapes.append(flat)

    # ---------- ulice: odcinki tras między kolejnymi przystankami na tej samej ulicy ----------
    def point_at(sid, d):
        pts, cum = shape_pts[sid], shape_cum[sid]
        for i in range(len(cum) - 1):
            if cum[i + 1] >= d:
                L = cum[i + 1] - cum[i] or 1
                f = (d - cum[i]) / L
                return (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f)
        return pts[-1]

    street_runs = collections.defaultdict(list)
    seen = set()
    for li, sl, dists in patterns:
        sid = shape_list[li]
        k = 0
        while k < len(sl) - 1:
            name = stop_street[sl[k]]
            m = k
            while m + 1 < len(sl) and name and stop_street[sl[m + 1]] == name:
                m += 1
            if name and m > k and dists[m] - dists[k] >= 80:
                a_, b_ = point_at(sid, dists[k]), point_at(sid, dists[m])
                key = (name,) + tuple(sorted([(round(a_[0] / 40), round(a_[1] / 40)), (round(b_[0] / 40), round(b_[1] / 40))]))
                if key not in seen:
                    seen.add(key)
                    street_runs[name].append([li, dists[k], dists[m]])
            k = m if m > k else k + 1
    out_streets = sorted(([n, runs] for n, runs in street_runs.items()),
                         key=lambda x: -sum(r[2] - r[1] for r in x[1]))

    dates = service_dates(src, rd)
    feed = rd('feed_info.txt')[0] if os.path.exists(src + 'feed_info.txt') else {}
    start = feed.get('feed_start_date') or (min(dates) if dates else '')
    end = feed.get('feed_end_date') or (max(dates) if dates else '')
    data = {
        'origin': [LAT0, LON0], 'kx': KX, 'ky': KY,
        'feed': {'publisher': feed.get('feed_publisher_name', ''), 'url': feed.get('feed_publisher_url', ''),
                 'version': feed.get('feed_version', ''), 'start': start, 'end': end,
                 'built': dt.datetime.now().strftime('%Y-%m-%d %H:%M')},
        'services': services, 'dates': dates,
        'routes': out_routes, 'stops': out_stops, 'shapes': out_shapes,
        # identyfikatory GTFS: dane na żywo (TripUpdates, komunikaty) wskazują linie i słupki po nich
        'route_ids': [r['route_id'] for r in routes], 'stop_ids': list(stop_idx),
        'patterns': patterns, 'heads': heads, 'trips': out_trips, 'streets': out_streets,
    }
    if any(r.get('m') == 1 for r in out_routes):
        data['feed']['rail_source'] = RAIL_SOURCE
    if bts_path and os.path.exists(bts_path):
        import bts
        data['bts'] = bts.compact(bts.load(bts_path), proj)
        data['feed']['bts_source'] = bts.SOURCE
    n_addr = 0
    if addresses and os.path.exists(addresses):
        data['addr'] = load_addresses(addresses, out_stops)
        n_addr = sum(len(a[3]) // 2 for a in data['addr'])
        data['feed']['addr_source'] = 'OpenStreetMap (ODbL) ' + dt.datetime.fromtimestamp(os.path.getmtime(addresses)).strftime('%Y-%m-%d')
    map_stats = {}
    if map_cache:
        from osm import compact, layer_path             # osm importuje proj z tego modułu
        data['map'], map_stats = compact(map_cache)
        if data['map']:
            data['feed']['map_source'] = 'OpenStreetMap (ODbL) ' + dt.datetime.fromtimestamp(os.path.getmtime(layer_path(map_cache, 'buildings'))).strftime('%Y-%m-%d')
        else:
            del data['map']
    if dem_path and os.path.exists(dem_path):
        import dem
        data['dem'] = dem.compact(dem.load(dem_path), proj, (LAT0, LON0))
        map_stats['dem_points'] = len(data['dem']['h'])
        data['feed']['dem_source'] = dem.SOURCE
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    return {**map_stats, 'routes': len(out_routes), 'stops': len(out_stops), 'shapes': len(out_shapes),
            'patterns': len(patterns), 'trips': len(out_trips), 'skipped_trips': skipped,
            'rail_trips': sum(1 for t in out_trips if out_routes[t[0]].get('m') == 1),
            'dates': len(dates), 'streets': len(out_streets), 'addresses': n_addr, 'start': start, 'end': end, 'version': feed.get('feed_version', '')}


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else 'data/ztm/'
    out = sys.argv[2] if len(sys.argv) > 2 else 'data.json'
    addr = sys.argv[3] if len(sys.argv) > 3 else None
    map_cache = sys.argv[4] if len(sys.argv) > 4 else None
    print(prepare(src, out, addr, map_cache))

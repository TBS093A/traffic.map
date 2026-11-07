#!/usr/bin/env python3
"""Świat z OpenStreetMap: budynki, woda, pokrycie terenu, drogi, tory i drzewa.

Użycie jako skrypt:  python3 osm.py <katalog_cache/> [map.json]
Użycie jako moduł:   from osm import compact; data, stats = compact('work/cache')

Surowe odpowiedzi Overpass (osm-*.json.gz) są zamieniane na kompaktowy słownik `map` w data.json.
Współrzędne to liczby całkowite w jednostkach 0,5 m, kodowane różnicowo (lepiej się kompresują).
"""
import collections
import gzip
import json
import math
import os
import re
import sys

from prep import dp, proj

Q = 2                                   # jednostki na metr
LAND_MIN_AREA = 150                     # mniejszych płatów terenu nie widać w skali mapy
BOX_FILL = .88                          # obrys wypełnia prostokąt w tym stopniu -> wystarczy bryła obrócona
BOX_MAX_AREA = 70                       # drobne budynki zawsze jako prostopadłościany
FLOOR_M = 3.0

LAND_CLASSES = ['residential', 'farmland', 'meadow', 'farmyard', 'industrial', 'orchard', 'cemetery', 'grass',
                'forest', 'scrub', 'wetland', 'sand', 'sport', 'parking', 'water']
LAND_TAGS = {
    'landuse': {'residential': 'residential', 'farmland': 'farmland', 'meadow': 'meadow', 'farmyard': 'farmyard',
                'industrial': 'industrial', 'commercial': 'industrial', 'retail': 'industrial',
                'construction': 'industrial', 'brownfield': 'industrial', 'railway': 'industrial',
                'orchard': 'orchard', 'vineyard': 'orchard', 'allotments': 'orchard', 'cemetery': 'cemetery',
                'grass': 'grass', 'village_green': 'grass', 'recreation_ground': 'grass', 'forest': 'forest',
                'reservoir': 'water', 'basin': 'water'},
    'natural': {'water': 'water', 'wood': 'forest', 'scrub': 'scrub', 'grassland': 'meadow', 'heath': 'meadow',
                'wetland': 'wetland', 'sand': 'sand', 'beach': 'sand'},
    'leisure': {'park': 'grass', 'garden': 'grass', 'golf_course': 'grass', 'pitch': 'sport', 'track': 'sport',
                'stadium': 'sport', 'sports_centre': 'sport'},
    'amenity': {'parking': 'parking'},
    'waterway': {'riverbank': 'water'},
}
ROAD_BUCKETS = {'motorway': 0, 'trunk': 0, 'primary': 0, 'motorway_link': 0, 'trunk_link': 0, 'primary_link': 0,
                'secondary': 1, 'tertiary': 1, 'secondary_link': 1, 'tertiary_link': 1,
                'unclassified': 2, 'residential': 2, 'living_street': 2, 'pedestrian': 2, 'service': 3}
RAIL_BUCKET = 4
ROAD_EPS = [1.5, 1.5, 1.5, 2.5, 2.5]

# budynek bez danych o wysokości: liczba kondygnacji i wygląd wg typu (7 = dach spadzisty, 0 = blok, 8 = hala)
FLOORS = {'house': 2, 'detached': 2, 'semidetached_house': 2, 'terrace': 2, 'residential': 2, 'bungalow': 1,
          'farm': 2, 'apartments': 5, 'dormitory': 5, 'hotel': 4, 'office': 4, 'hospital': 4, 'university': 4,
          'school': 3, 'college': 3, 'kindergarten': 2, 'public': 3, 'civic': 3, 'government': 3, 'commercial': 2,
          'retail': 1, 'supermarket': 1, 'church': 3, 'industrial': 2, 'warehouse': 2, 'manufacture': 2,
          'garage': 1, 'garages': 1, 'shed': 1, 'hut': 1, 'cabin': 1, 'barn': 2, 'stable': 1, 'farm_auxiliary': 1,
          'outbuilding': 1, 'greenhouse': 1, 'service': 1, 'roof': 1, 'construction': 1, 'carport': 1}
KIND = {'apartments': 0, 'dormitory': 0, 'hotel': 0, 'office': 0, 'hospital': 0, 'university': 0, 'school': 0,
        'college': 0, 'public': 0, 'civic': 0, 'government': 0, 'commercial': 0,
        'retail': 8, 'supermarket': 8, 'industrial': 8, 'warehouse': 8, 'manufacture': 8, 'garage': 8, 'garages': 8,
        'greenhouse': 8, 'service': 8, 'roof': 8, 'carport': 8, 'construction': 8}
SKIP_BUILDING = {'no', 'ruins', 'collapsed', 'demolished', 'proposed', 'razed'}


def queries(bbox, timeout):
    """Zapytania Overpass dla każdej warstwy."""
    s, w, n, e = bbox
    b = f'({s},{w},{n},{e})'
    head = f'[out:json][timeout:{timeout}];'      # bez dużego maxsize: obciążony serwer od razu odrzuca takie zapytania
    union = []
    for key, vals in LAND_TAGS.items():
        rx = '|'.join(sorted(vals))
        union.append(f'way["{key}"~"^({rx})$"]{b};')
        if key != 'amenity':
            union.append(f'relation["{key}"~"^({rx})$"]{b};')
    union.append(f'way["waterway"~"^(river|stream|canal)$"]{b};')
    roads = '|'.join(sorted(ROAD_BUCKETS))
    return {
        'buildings': f'{head}(way["building"]{b};relation["building"]["type"="multipolygon"]{b};);out tags geom;',
        'land': f'{head}({"".join(union)});out tags geom;',
        'roads': f'{head}(way["highway"~"^({roads})$"]{b};way["railway"="rail"]{b};);out tags geom;',
        'trees': f'{head}node["natural"="tree"]{b};out skel;',
    }


def layer_path(cache, name):
    return os.path.join(cache, f'osm-{name}.json.gz')


def load_layer(cache, name):
    path = layer_path(cache, name)
    if not os.path.exists(path):
        return []
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        return json.load(f).get('elements', [])


def to_xy(geometry):
    return [proj(p['lat'], p['lon']) for p in geometry]


def signed_area(pts):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        a += x0 * y1 - x1 * y0
    return a / 2


def inside(pt, ring):
    x, y = pt
    res = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            res = not res
    return res


def open_ring(pts, eps):
    """Zamknięta linia -> uproszczony pierścień bez powtórzonego punktu; zbyt mały zwraca None."""
    if len(pts) < 4 or pts[0] != pts[-1]:
        return None
    # dwa punkty zaczepienia: inaczej pierścień, którego końce się pokrywają, zniknąłby przy upraszczaniu
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    if far == 0:
        return None
    ring = dp(pts[:far + 1], eps)[:-1] + dp(pts[far:], eps)[:-1]
    return ring if len(ring) >= 3 else None


def stitch(ways):
    """Łączy odcinki z relacji w zamknięte pierścienie (lista list punktów lat/lon)."""
    key = lambda p: (round(p['lat'], 7), round(p['lon'], 7))
    pool = [list(w) for w in ways if len(w) >= 2]
    ends = collections.defaultdict(list)
    for i, w in enumerate(pool):
        ends[key(w[0])].append(i)
        ends[key(w[-1])].append(i)
    used = [False] * len(pool)
    rings = []
    for i, w in enumerate(pool):
        if used[i]:
            continue
        used[i] = True
        cur = list(w)
        while key(cur[0]) != key(cur[-1]):
            nxt = next((j for j in ends[key(cur[-1])] if not used[j]), None)
            if nxt is None:
                break
            used[nxt] = True
            seg = pool[nxt]
            cur += (seg if key(seg[0]) == key(cur[-1]) else seg[::-1])[1:]
        if len(cur) >= 4 and key(cur[0]) == key(cur[-1]):
            cur[-1] = cur[0]
            rings.append(cur)
    return rings


def polygons(e, eps):
    """Element OSM -> lista (zewnętrzny, [dziury]) w metrach; zewnętrzny CCW, dziury CW."""
    outer, holes = [], []
    if e['type'] == 'way':
        ring = open_ring(to_xy(e.get('geometry') or []), eps)
        if ring:
            outer.append(ring)
    else:
        members = [m for m in e.get('members', []) if m.get('type') == 'way' and m.get('geometry')]
        for role, out in (('outer', outer), ('inner', holes)):
            for r in stitch([m['geometry'] for m in members if (m.get('role') or 'outer') == role]):
                ring = open_ring(to_xy(r), eps)
                if ring:
                    out.append(ring)
    res = []
    for o in outer:
        if signed_area(o) < 0:
            o = o[::-1]
        res.append((o, []))
    for h in holes:
        if signed_area(h) > 0:
            h = h[::-1]
        for o, hs in res:
            if inside(h[0], o):
                hs.append(h)
                break
    return res


def enc_ring(pts):
    """Pierścień lub linia -> [x0, y0, dx1, dy1, ...] w jednostkach Q."""
    out, px, py = [], 0, 0
    for x, y in pts:
        X, Y = round(x * Q), round(y * Q)
        out += [X - px, Y - py]
        px, py = X, Y
    return out


def min_rect(pts):
    """Najmniejszy prostokąt po kierunkach krawędzi: (pole, cx, cy, kąt, długość, szerokość)."""
    best = None
    seen = set()
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        a = math.atan2(y1 - y0, x1 - x0) % math.pi
        k = round(a, 3)
        if k in seen:
            continue
        seen.add(k)
        c, s = math.cos(a), math.sin(a)
        us = [x * c + y * s for x, y in pts]
        vs = [-x * s + y * c for x, y in pts]
        L, W = max(us) - min(us), max(vs) - min(vs)
        if best is None or L * W < best[0]:
            mu, mv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            best = (L * W, mu * c - mv * s, mu * s + mv * c, a, L, W)
    return best


def number(v):
    m = re.match(r'\s*(\d+(?:[.,]\d+)?)', str(v or ''))
    return float(m.group(1).replace(',', '.')) if m else None


def building_style(tags, area):
    """Wysokość w metrach i wygląd budynku. Zwraca też, czy wysokość pochodzi z danych OSM."""
    typ = tags.get('building', 'yes')
    h = number(tags.get('height'))
    levels = number(tags.get('building:levels'))
    real = h is not None or levels is not None
    if h is None and levels is not None:
        h = (levels + .5 * (number(tags.get('roof:levels')) or 0)) * FLOOR_M + .6
    if h is None:
        floors = FLOORS.get(typ)
        if floors is None:                      # building=yes: oceniamy po powierzchni obrysu
            floors = 1 if area < 35 else 2 if area < 250 else 3 if area < 1200 else 2
        h = floors * FLOOR_M + .6
    if typ in KIND:
        kind = KIND[typ]
    elif typ in FLOORS:
        kind = 7
    else:
        kind = 7 if area < 300 else 0 if area < 1500 else 8
    if area < 35:
        kind = 7 if typ in FLOORS and typ not in KIND else 8
    return max(2.5, min(h, 260)), kind, real


def compact_buildings(elements):
    boxes, polys, n_real = [], [], 0
    for e in elements:
        tags = e.get('tags') or {}
        if tags.get('building') in SKIP_BUILDING or tags.get('location') == 'underground' or tags.get('tunnel') == 'yes':
            continue
        if str(tags.get('layer', '')).startswith('-'):
            continue
        for outer, holes in polygons(e, 1.0):
            area = signed_area(outer) - sum(-signed_area(h) for h in holes)
            if area < 6:
                continue
            h, kind, real = building_style(tags, area)
            n_real += real
            rect = min_rect(outer) if len(outer) <= 96 else None
            if rect and not holes and (area / max(rect[0], 1e-6) >= BOX_FILL or area < BOX_MAX_AREA):
                boxes.append((round(rect[1] * Q), round(rect[2] * Q), round(math.degrees(rect[3]) * 2) % 360,
                              max(2, round(rect[4] * Q)), max(2, round(rect[5] * Q)), round(h * Q), kind))
            else:
                polys.append([round(h * Q), kind, enc_ring(outer)] + [enc_ring(r) for r in holes])
    boxes.sort(key=lambda b: (b[0] // 1000, b[1] // 1000, b[0], b[1]))
    cols = list(zip(*boxes)) or [()] * 7
    def delta(col):
        return [b - a for a, b in zip((0,) + col, col)]
    return ({'x': delta(cols[0]), 'y': delta(cols[1]), 'a': list(cols[2]), 'l': list(cols[3]), 'w': list(cols[4]),
             'h': list(cols[5]), 'k': list(cols[6])}, polys, n_real)


def land_class(tags):
    for key, vals in LAND_TAGS.items():
        if tags.get(key) in vals:
            return LAND_CLASSES.index(vals[tags[key]])
    return None


def compact_land(elements):
    water = LAND_CLASSES.index('water')
    land = []
    rivers, streams = [], []
    for e in elements:
        tags = e.get('tags') or {}
        ww = tags.get('waterway')
        if ww in ('river', 'canal', 'stream'):
            if tags.get('tunnel') or e['type'] != 'way':
                continue
            pts = dp(to_xy(e.get('geometry') or []), 4 if ww == 'stream' else 2)
            if len(pts) >= 2:
                (streams if ww == 'stream' else rivers).append(enc_ring(pts))
            continue
        if tags.get('covered') == 'yes' or tags.get('tunnel'):
            continue
        cls = land_class(tags)
        if cls is None:
            continue
        for outer, holes in polygons(e, 1.5 if cls == water else 3):
            if signed_area(outer) >= LAND_MIN_AREA:
                land.append((cls, outer, holes))
    land.sort(key=lambda x: x[0])                       # rysowane po kolei: woda na wierzchu
    return [[c, enc_ring(o)] + [enc_ring(h) for h in hs] for c, o, hs in land], rivers, streams


def compact_roads(elements):
    buckets = [[] for _ in range(RAIL_BUCKET + 1)]
    for e in elements:
        tags = e.get('tags') or {}
        if tags.get('tunnel') in ('yes', 'building_passage') or tags.get('area') == 'yes':
            continue
        b = RAIL_BUCKET if tags.get('railway') == 'rail' else ROAD_BUCKETS.get(tags.get('highway'))
        if b is None or not e.get('geometry'):
            continue
        pts = dp(to_xy(e['geometry']), ROAD_EPS[b])
        if len(pts) >= 2:
            buckets[b].append(enc_ring(pts))
    return buckets


def compact(cache):
    """Czyta warstwy z katalogu cache. Zwraca (słownik map, statystyki) albo (None, {}), gdy nie ma budynków."""
    elements = load_layer(cache, 'buildings')
    if not elements:
        return None, {}
    b, polys, n_real = compact_buildings(elements)
    del elements
    n_buildings = len(b['x']) + len(polys)
    land, rivers, streams = compact_land(load_layer(cache, 'land'))
    roads = compact_roads(load_layer(cache, 'roads'))
    trees = enc_ring(sorted((proj(e['lat'], e['lon']) for e in load_layer(cache, 'trees') if 'lat' in e)))
    data = {'classes': LAND_CLASSES, 'b': b, 'p': polys, 'l': land, 'r': roads, 'w': [rivers, streams], 't': trees}
    stats = {'buildings': n_buildings, 'buildings_mesh': len(polys), 'buildings_real_height': n_real,
             'land_polygons': len(land), 'road_lines': sum(len(x) for x in roads),
             'water_lines': len(rivers) + len(streams), 'trees_osm': len(trees) // 2}
    return data, stats


if __name__ == '__main__':
    out = sys.argv[2] if len(sys.argv) > 2 else 'map.json'
    d, st = compact(sys.argv[1] if len(sys.argv) > 1 else 'work/cache')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(d, f, separators=(',', ':'))
    print(st)

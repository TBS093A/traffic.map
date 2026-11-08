#!/usr/bin/env python3
"""Mała, sztuczna sieć GTFS do testów (bez pobierania czegokolwiek).

Układ (metry od Rynku, x = wschód, y = północ):

    linia A:  Zachód (-3000, 0) → Środek (-1500, 0) → Centrum 01 (0, 0)          co 10 min, 5 min między przystankami
    linia B:  Centrum 02 (60, 0) → Północ (60, 1500) → Daleko (60, 3000)          co 15 min, 4 min między przystankami

Z Zachodu na Daleko trzeba się przesiąść w Centrum (dojście 60 m między słupkami).
Użycie jako skrypt: python3 tests/fixture.py <katalog_gtfs> [data.json]
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from prep import LAT0, LON0, KX, KY, prepare  # noqa: E402

STOPS = [  # id, nazwa, kod, x, y, ulica
    ('W', 'Zachód', '01', -3000, 0, 'Testowa'),
    ('M', 'Środek', '01', -1500, 0, 'Testowa'),
    ('C1', 'Centrum 01', '01', 0, 0, 'Testowa'),
    ('C2', 'Centrum 02', '02', 60, 0, 'Północna'),
    ('N', 'Północ', '01', 60, 1500, 'Północna'),
    ('F', 'Daleko', '01', 60, 3000, 'Północna'),
]
LINES = {  # linia: (przystanki, pierwszy kurs [min], ostatni, co ile, min między przystankami, kierunek)
    'A': (['W', 'M', 'C1'], 6 * 60, 8 * 60, 10, 5, 'Centrum'),
    'B': (['C2', 'N', 'F'], 6 * 60, 9 * 60, 15, 4, 'Daleko'),
}


def latlon(x, y):
    return LAT0 + y / KY, LON0 + x / KX


def hms(minutes):
    return f'{minutes // 60:02d}:{minutes % 60:02d}:00'


def make_gtfs(dest):
    os.makedirs(dest, exist_ok=True)

    def write(name, header, rows):
        with open(os.path.join(dest, name), 'w', encoding='utf-8', newline='') as f:
            f.write(','.join(header) + '\n')
            for r in rows:
                f.write(','.join(str(c) for c in r) + '\n')

    pos = {s[0]: (s[3], s[4]) for s in STOPS}
    write('stops.txt', ['stop_id', 'stop_name', 'stop_code', 'stop_lat', 'stop_lon', 'street_name'],
          [(sid, name, code, *('%.7f' % v for v in latlon(x, y)), street) for sid, name, code, x, y, street in STOPS])
    write('routes.txt', ['route_id', 'route_short_name', 'route_long_name', 'route_type'],
          [(r, r, f'Linia {r}', 3) for r in LINES])
    write('calendar.txt', ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
          [('POW', 1, 1, 1, 1, 1, 0, 0, '20260101', '20261231'), ('SW', 0, 0, 0, 0, 0, 1, 1, '20260101', '20261231')])
    shapes, trips, times = [], [], []
    for r, (stops, first, last, every, hop, head) in LINES.items():
        seq = 0
        for a, b in zip(stops, stops[1:]):        # trasa: prosta między przystankami, punkt co 100 m
            (ax, ay), (bx, by) = pos[a], pos[b]
            n = max(1, int(math.hypot(bx - ax, by - ay) // 100))
            for i in range(n + (b == stops[-1])):
                la, lo = latlon(ax + (bx - ax) * i / n, ay + (by - ay) * i / n)
                shapes.append((f'sh{r}', '%.7f' % la, '%.7f' % lo, seq))
                seq += 1
        k = 0
        for t0 in range(first, last + 1, every):
            for sv in ('POW', 'SW'):
                if sv == 'SW' and (t0 - first) % (2 * every):    # w weekend co drugi kurs
                    continue
                tid = f'{r}-{sv}-{k}'
                k += 1
                trips.append((r, sv, tid, head, f'sh{r}', f'{r}/1'))
                for i, s in enumerate(stops):
                    times.append((tid, hms(t0 + i * hop), hms(t0 + i * hop), s, i + 1))
    write('shapes.txt', ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], shapes)
    write('trips.txt', ['route_id', 'service_id', 'trip_id', 'trip_headsign', 'shape_id', 'brigade'], trips)
    write('stop_times.txt', ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], times)
    write('feed_info.txt', ['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_version', 'feed_start_date', 'feed_end_date'],
          [('Test', 'https://example.invalid', 'pl', 'test-1', '20260101', '20261231')])
    return dest


if __name__ == '__main__':
    d = make_gtfs(sys.argv[1])
    if len(sys.argv) > 2:
        print(prepare(d, sys.argv[2]))

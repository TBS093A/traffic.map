#!/usr/bin/env python3
"""Porównanie dwóch wersji rozkładu: co się zmieniło w liniach i przystankach.

Pipeline zapisuje streszczenie każdego zbudowanego rozkładu (work/summary.json). Przy nowej paczce
porównuje je z poprzednim i zapisuje dist/changes.json, który strona pokazuje jako „Zmiany w rozkładzie”.

Użycie jako skrypt:  python3 diff.py stary_data.json nowy_data.json
"""
import datetime as dt
import json
import re
import statistics
import sys

DAY_NAMES = {'wd': 'dni robocze', 'sat': 'soboty', 'sun': 'niedziele'}


def base_name(name):
    return re.sub(r'\s+\d+\S*(\s+nż)?$', '', name).strip() or name


def day_types(dates):
    """Reprezentatywny dzień każdego typu (jak w przeglądarce): typ -> zbiór usług."""
    out = {}
    for ymd in sorted(dates):
        wd = dt.date(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:])).weekday()
        t = 'sat' if wd == 5 else 'sun' if wd == 6 else 'wd'
        out.setdefault(t, set(dates[ymd]))
    return out


def summarize(D):
    """Streszczenie rozkładu: dla każdej linii liczba kursów w typach dni, pierwszy i ostatni kurs,
    takt w szczycie (dni robocze 7–9) i lista przystanków."""
    services = D['services']
    days = day_types(D['dates'])
    routes = {}
    for ri, r in enumerate(D['routes']):
        routes[r['n']] = {'name': r.get('name', ''), 'days': {t: 0 for t in days}, 'first': None, 'last': None, 'stops': set(), 'peak': []}
    by_route_stop = {}
    for route, service, pat, head, brig, tid, t0, deltas in D['trips']:
        r = routes[D['routes'][route]['n']]
        sv = services[service]
        stops = D['patterns'][pat][1]
        for s in stops:
            r['stops'].add(base_name(D['stops'][s][2]))
        for t, svs in days.items():
            if sv in svs:
                r['days'][t] += 1
        if 'wd' in days and sv in days['wd']:
            r['first'] = t0 if r['first'] is None else min(r['first'], t0)
            r['last'] = t0 if r['last'] is None else max(r['last'], t0)
            by_route_stop.setdefault((route, stops[0]), []).append(t0)
    for (route, _), starts in by_route_stop.items():
        starts.sort()
        gaps = [b - a for a, b in zip(starts, starts[1:]) if 7 * 3600 <= a < 9 * 3600]
        if gaps:
            routes[D['routes'][route]['n']]['peak'].append(statistics.median(gaps))
    out = {}
    for n, r in routes.items():
        out[n] = {'name': r['name'], 'days': r['days'], 'first': r['first'], 'last': r['last'],
                  'peak': round(min(r['peak']) / 60) if r['peak'] else None, 'stops': sorted(r['stops'])}
    return {'version': D.get('feed', {}).get('version', ''), 'start': D.get('feed', {}).get('start', ''),
            'routes': out, 'stops': sorted({base_name(s[2]) for s in D['stops']})}


def hm(s):
    return f'{s // 3600 % 24:02d}:{s // 60 % 60:02d}' if s is not None else '—'


def compare(old, new):
    """Lista zmian czytelna dla człowieka (po polsku)."""
    o, n = old['routes'], new['routes']
    added = sorted(set(n) - set(o), key=_route_key)
    removed = sorted(set(o) - set(n), key=_route_key)
    changed = []
    for name in sorted(set(o) & set(n), key=_route_key):
        a, b, notes = o[name], n[name], []
        for t, label in DAY_NAMES.items():
            x, y = a['days'].get(t, 0), b['days'].get(t, 0)
            if x != y and (abs(x - y) >= 2 or not x or not y):
                notes.append(f'{label}: {x} → {y} kursów' if x and y else (f'{label}: nie kursuje' if not y else f'{label}: kursuje ({y} kursów)'))
        if a['peak'] and b['peak'] and a['peak'] != b['peak']:
            notes.append(f'w szczycie co {a["peak"]} → {b["peak"]} min')
        if a['first'] != b['first'] and a['first'] is not None and b['first'] is not None and abs(a['first'] - b['first']) >= 300:
            notes.append(f'pierwszy kurs {hm(a["first"])} → {hm(b["first"])}')
        if a['last'] != b['last'] and a['last'] is not None and b['last'] is not None and abs(a['last'] - b['last']) >= 300:
            notes.append(f'ostatni kurs {hm(a["last"])} → {hm(b["last"])}')
        plus, minus = sorted(set(b['stops']) - set(a['stops'])), sorted(set(a['stops']) - set(b['stops']))
        if plus:
            notes.append('nowe przystanki: ' + ', '.join(plus[:6]) + (' …' if len(plus) > 6 else ''))
        if minus:
            notes.append('już nie zatrzymuje się: ' + ', '.join(minus[:6]) + (' …' if len(minus) > 6 else ''))
        if notes:
            changed.append({'route': name, 'notes': notes})
    return {'from': old.get('version', ''), 'to': new.get('version', ''), 'start': new.get('start', ''),
            'added_routes': added, 'removed_routes': removed, 'changed': changed,
            'added_stops': sorted(set(new['stops']) - set(old['stops'])), 'removed_stops': sorted(set(old['stops']) - set(new['stops']))}


def is_empty(ch):
    return not (ch['added_routes'] or ch['removed_routes'] or ch['changed'] or ch['added_stops'] or ch['removed_stops'])


def _route_key(n):
    num = ''.join(c for c in n if c.isdigit())
    return (0 if n[:1].isdigit() else 1, int(num) if num else 0, n)


if __name__ == '__main__':
    with open(sys.argv[1], encoding='utf-8') as f:
        a = summarize(json.load(f))
    with open(sys.argv[2], encoding='utf-8') as f:
        b = summarize(json.load(f))
    json.dump(compare(a, b), sys.stdout, ensure_ascii=False, indent=2)
    print()

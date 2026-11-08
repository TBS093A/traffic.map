"""Infrastruktura: stacje bazowe z arkuszy UKE (bts.py) i warstwa OSM z lotniskiem, siecią energetyczną i stacjami paliw."""
import io
import os
import sys
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bts  # noqa: E402
import osm  # noqa: E402
from prep import proj  # noqa: E402

BBOX = [49.90, 21.78, 50.14, 22.26]


def xlsx(rows):
    """Minimalny arkusz xlsx: teksty we wspólnej tabeli, jak w plikach UKE."""
    strings, cells = [], []
    for r, row in enumerate(rows, 1):
        cs = []
        for c, v in enumerate(row):
            if v not in strings:
                strings.append(v)
            cs.append(f'<c r="{chr(65 + c)}{r}" t="s"><v>{strings.index(v)}</v></c>')
        cells.append(f'<row r="{r}">{"".join(cs)}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    sst = ''.join(f'<si><t>{s}</t></si>' for s in strings)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('xl/sharedStrings.xml', f'<sst {ns}>{sst}</sst>')
        z.writestr('xl/worksheets/sheet1.xml', f'<worksheet {ns}><sheetData>{"".join(cells)}</sheetData></worksheet>')
    return buf.getvalue()


HEAD = ['Nazwa Operatora', 'Nr Decyzji', 'Rodzaj decyzji', 'Data ważności', 'Dł geogr stacji', 'Szer geogr stacji', 'Miejscowość', 'Lokalizacja', 'IdStacji', 'TERYT']


class BtsTest(unittest.TestCase):
    def test_helpers(self):
        self.assertAlmostEqual(bts.dms('22E00\'18"'), 22.005, places=4)
        self.assertAlmostEqual(bts.dms('50N02\'15"'), 50.0375, places=4)
        self.assertIsNone(bts.dms('brak'))
        self.assertEqual(bts.operator('P4 Sp. z o.o.'), 'Play')
        self.assertEqual(bts.operator('Polkomtel Sp. z o.o.'), 'Plus')
        self.assertEqual(bts.tech('https://x/lte800_-_stan_na_2026-10-26.xlsx'), 'LTE800')
        self.assertEqual(bts.tech('gsm-r_-_stan_na_2026-10-26.xlsx'), 'GSM-R')

    def test_links_skip_private_networks(self):
        html = '<a href="/d/lte800_-_stan.xlsx">a</a><a href="/d/sieci_prywatne_3800.xlsx">b</a>'
        self.assertEqual(bts.links('https://bip.uke.gov.pl/x.html', html), ['https://bip.uke.gov.pl/d/lte800_-_stan.xlsx'])

    def test_collect_groups_by_location(self):
        rz = ['22E00\'18"', '50N02\'15"', 'Rzeszów', 'Rynek 1', '1', '1']
        far = ['20E47\'02"', '52N04\'06"', 'Młochów', 'Aleja 1', '2', '2']
        lte = bts.read_xlsx(xlsx([HEAD, ['Orange Polska S.A.', 'D1', 'P', '2030'] + rz, ['P4 Sp. z o.o.', 'D2', 'P', '2030'] + far]))
        nr = bts.read_xlsx(xlsx([HEAD, ['Orange Polska S.A.', 'D3', 'P', '2030'] + rz, ['T-Mobile Polska S.A.', 'D4', 'P', '2030'] + rz]))
        doc = bts.collect([('lte800_-_stan.xlsx', lte), ('5g3600_-_stan.xlsx', nr)], BBOX)
        self.assertEqual(len(doc['sites']), 1)
        site = doc['sites'][0]
        self.assertEqual(site['loc'], 'Rynek 1, Rzeszów')
        self.assertEqual(site['tx'], [['Orange', ['5G3600', 'LTE800']], ['T-Mobile', ['5G3600']]])
        c = bts.compact(doc, proj)
        self.assertEqual(c['ops'], ['Orange', 'T-Mobile'])
        self.assertEqual(c['s'][0][3], [[0, '5G3600 LTE800'], [1, '5G3600']])
        self.assertLess(abs(c['s'][0][0]) + abs(c['s'][0][1]), 50)          # tuż przy Rynku


def way(tags, pts):
    return {'type': 'way', 'tags': tags, 'geometry': [{'lat': la, 'lon': lo} for la, lo in pts]}


class OsmInfraTest(unittest.TestCase):
    def test_compact_infra(self):
        sq = [(50.11, 22.01), (50.11, 22.02), (50.12, 22.02), (50.12, 22.01), (50.11, 22.01)]
        els = [
            way({'aeroway': 'runway', 'width': '45'}, [(50.10, 22.0), (50.12, 22.05)]),
            way({'aeroway': 'taxiway'}, [(50.10, 22.01), (50.11, 22.02)]),
            way({'aeroway': 'apron'}, sq),
            way({'power': 'line', 'voltage': '110000'}, [(50.0, 22.0), (50.001, 22.003), (50.002, 22.006)]),
            way({'power': 'minor_line'}, [(50.0, 22.1), (50.0, 22.101)]),
            way({'power': 'substation'}, sq),
            {'type': 'node', 'lat': 50.03, 'lon': 22.0, 'tags': {'man_made': 'mast', 'tower:type': 'communication', 'height': '52', 'operator': 'Emitel'}},
            {'type': 'node', 'lat': 50.03, 'lon': 22.0, 'tags': {'man_made': 'tower', 'tower:type': 'bell_tower'}},
            {'type': 'node', 'lat': 50.04, 'lon': 22.0, 'tags': {'amenity': 'fuel', 'brand': 'Orlen', 'fuel:lpg': 'yes', 'opening_hours': '24/7'}},
            {'type': 'node', 'lat': 50.05, 'lon': 22.0, 'tags': {'amenity': 'charging_station', 'name': 'GreenWay', 'capacity': '2',
                                                                 'socket:type2_combo': '2', 'socket:type2_combo:output': '50 kW', 'socket:chademo': 'no'}},
        ]
        d = osm.compact_infra(els)
        self.assertEqual(d['air']['rw'][0][0], 45)
        self.assertEqual(len(d['air']['tw']), 1)
        self.assertEqual(len(d['air']['ap']), 1)
        self.assertEqual([(kv, minor) for kv, minor, _ in d['pw']['l']], [(110, 0), (0, 1)])
        self.assertEqual(len(d['pw']['l'][0][2]), 6)                      # bez upraszczania: 3 słupy
        self.assertEqual(len(d['pw']['ss']), 1)
        self.assertEqual([(m[2], m[3], m[4]) for m in d['m']], [(52, 0, 'Emitel')])   # dzwonnica pominięta
        fuel, ev = d['f']
        self.assertEqual(fuel[2:], [0, 'Orlen', 'LPG · 24h'])
        self.assertEqual(ev[2:], [1, 'GreenWay', 'stanowiska: 2 · type2 combo · do 50 kW'])

    def test_infra_query_present(self):
        q = osm.queries(BBOX, 100)
        self.assertIn('infra', q)
        self.assertIn('aeroway', q['infra'])
        self.assertIn('charging_station', q['infra'])


if __name__ == '__main__':
    unittest.main()

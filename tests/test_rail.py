"""Pociągi (rail.py): przycinanie kursów do obszaru mapy i dopisanie do GTFS autobusów; prep.py oznacza je trybem 1."""
import csv
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import rail  # noqa: E402
from fixture import make_gtfs, latlon  # noqa: E402
from prep import prepare  # noqa: E402

BBOX = (49.90, 21.78, 50.14, 22.26)


def csv_text(header, rows):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue()


def rail_zip(path):
    """Kurs Kraków -> Rzeszów Zachodni -> Rzeszów Główny -> Przemyśl: w obszarze tylko dwie środkowe stacje."""
    stops = [('KRK', 'Kraków Główny', '', 50.067, 19.947, '0'), ('RZZ', 'Rzeszów Zachodni', '1 t. 2', 50.0527, 21.9942, '0'),
             ('RZG', 'Rzeszów Główny', '2 t. 4', 50.0430, 22.0060, '0'), ('PRZ', 'Przemyśl Główny', '', 49.784, 22.776, '0'),
             ('RZG_ST', 'Rzeszów Główny', '', 50.0430, 22.0060, '1')]
    shape = [(50.067, 19.947), (50.06, 21.0), (50.0527, 21.9942), (50.048, 22.0), (50.0430, 22.0060), (49.9, 22.4), (49.784, 22.776)]
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('routes.txt', csv_text(['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color'],
                                          [['IC_IC', 'IC', 'IC', 'InterCity', '2', 'F25E18'], ['BUS', 'IC', 'ZKA', 'Zastępcza', '3', '']]))
        z.writestr('stops.txt', csv_text(['stop_id', 'stop_name', 'platform_code', 'stop_lat', 'stop_lon', 'location_type'], stops))
        z.writestr('trips.txt', csv_text(['trip_id', 'route_id', 'service_id', 'shape_id', 'trip_short_name', 'trip_headsign'],
                                         [['T1', 'IC_IC', 'S1', 'SH1', '3810/1 Kossak', 'Przemyśl Główny'],
                                          ['T2', 'IC_IC', 'S1', 'SH1', '1', 'Kraków Główny'],          # jedna stacja w obszarze: odpada
                                          ['T3', 'BUS', 'S1', '', '9', 'Rzeszów']]))                     # autobus zastępczy: odpada
        z.writestr('stop_times.txt', csv_text(['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'],
                                              [['T1', '06:00:00', '06:00:00', 'KRK', 1], ['T1', '08:00:00', '08:02:00', 'RZZ', 2],
                                               ['T1', '08:06:00', '08:10:00', 'RZG', 3], ['T1', '09:30:00', '09:30:00', 'PRZ', 4],
                                               ['T2', '10:00:00', '10:00:00', 'RZG', 1], ['T2', '12:00:00', '12:00:00', 'KRK', 2],
                                               ['T3', '10:00:00', '10:00:00', 'RZZ', 1], ['T3', '10:10:00', '10:10:00', 'RZG', 2]]))
        z.writestr('shapes.txt', csv_text(['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'],
                                          [['SH1', la, lo, i] for i, (la, lo) in enumerate(shape)]))
        z.writestr('calendar_dates.txt', csv_text(['service_id', 'date', 'exception_type'], [['S1', '20260601', '1'], ['S2', '20260601', '1']]))


class RailTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.zip = os.path.join(self.tmp.name, 'rail.zip')
        rail_zip(self.zip)

    def tearDown(self):
        self.tmp.cleanup()

    def test_is_rail(self):
        self.assertTrue(rail.is_rail('2'))
        self.assertTrue(rail.is_rail('106'))
        self.assertFalse(rail.is_rail('3'))
        self.assertFalse(rail.is_rail(''))

    def test_extract_clips_to_area(self):
        out = rail.extract(self.zip, BBOX)
        self.assertEqual([t['trip_id'] for t in out['trips.txt']], ['R:T1'])
        t = out['trips.txt'][0]
        self.assertEqual(t['brigade'], '3810/1 Kossak')
        self.assertEqual(t['route_id'], 'R:IC_IC')
        self.assertEqual([r['stop_id'] for r in out['stop_times.txt']], ['R:RZZ', 'R:RZG'])
        self.assertEqual(out['stop_times.txt'][1]['departure_time'], '08:10:00')
        # przebieg przycięty do odcinka Zachodni -> Główny (punkty 2..4 z 7)
        self.assertEqual(len(out['shapes.txt']), 3)
        self.assertEqual({s['stop_code'] for s in out['stops.txt']}, {'1 t. 2', '2 t. 4'})
        self.assertEqual(out['routes.txt'][0]['route_color'], 'F25E18')
        self.assertEqual([r['service_id'] for r in out['calendar_dates.txt']], ['R:S1'])

    def test_merge_and_prepare(self):
        gtfs, data = os.path.join(self.tmp.name, 'gtfs'), os.path.join(self.tmp.name, 'data.json')
        make_gtfs(gtfs)
        st = rail.merge(gtfs, self.zip, BBOX)
        self.assertEqual(st['rail_trips'], 1)
        stats = prepare(gtfs, data)
        self.assertEqual(stats['rail_trips'], 1)
        with open(data, encoding='utf-8') as f:
            D = json.load(f)
        ri = next(i for i, r in enumerate(D['routes']) if r.get('m') == 1)
        self.assertEqual(D['routes'][ri]['c'], [0xF2, 0x5E, 0x18])
        rail_stops = [s for s in D['stops'] if len(s) > 5 and s[5] == 1]
        self.assertEqual(sorted(s[2] for s in rail_stops), ['Rzeszów Główny', 'Rzeszów Zachodni'])
        self.assertTrue(all(len(s) == 5 for s in D['stops'] if s[2] not in ('Rzeszów Główny', 'Rzeszów Zachodni')))
        self.assertIn('rail_source', D['feed'])
        trip = next(t for t in D['trips'] if t[0] == ri)
        self.assertEqual(trip[4], '3810/1 Kossak')
        self.assertIn('20260601', D['dates'])

    def test_fixture_latlon_inside_area(self):
        lat, lon = latlon(0, 0)
        self.assertTrue(BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3])


if __name__ == '__main__':
    unittest.main()

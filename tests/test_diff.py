"""Porównanie wersji rozkładu (diff.py) na sieci testowej i jej zmienionej kopii."""
import copy
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from diff import summarize, compare, is_empty  # noqa: E402
from fixture import make_gtfs  # noqa: E402
from prep import prepare  # noqa: E402


class DiffTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, 'data.json')
            prepare(make_gtfs(os.path.join(d, 'gtfs')), out)
            with open(out, encoding='utf-8') as f:
                cls.D = json.load(f)

    def test_summary(self):
        s = summarize(self.D)
        a = s['routes']['A']
        self.assertEqual(a['days'], {'wd': 13, 'sat': 7, 'sun': 7})
        self.assertEqual(a['peak'], 10)
        self.assertEqual(a['first'], 6 * 3600)
        self.assertIn('Centrum', a['stops'])

    def test_same_schedule_has_no_changes(self):
        self.assertTrue(is_empty(compare(summarize(self.D), summarize(self.D))))

    def test_detects_fewer_trips_new_line_and_dropped_stop(self):
        new = copy.deepcopy(self.D)
        a = new['routes'].index(next(r for r in new['routes'] if r['n'] == 'A'))
        # linia A: co drugi kurs w dni robocze znika
        wd = new['services'].index('POW')
        keep, drop = [], 0
        for t in new['trips']:
            if t[0] == a and t[1] == wd and (t[6] // 600) % 2 == 1:
                drop += 1
                continue
            keep.append(t)
        new['trips'] = keep
        # nowa linia C jako kopia B
        new['routes'].append({'n': 'C', 'name': 'Linia C', 'c': [1, 2, 3]})
        new['trips'] += [[len(new['routes']) - 1, *t[1:]] for t in self.D['trips'] if self.D['routes'][t[0]]['n'] == 'B']
        new['feed']['version'] = 'test-2'
        ch = compare(summarize(self.D), summarize(new))
        self.assertEqual(ch['added_routes'], ['C'])
        self.assertEqual(ch['to'], 'test-2')
        notes = next(c for c in ch['changed'] if c['route'] == 'A')['notes']
        self.assertTrue(any(n.startswith('dni robocze: 13 → ') for n in notes), notes)
        self.assertIn('w szczycie co 10 → 20 min', notes)
        self.assertGreater(drop, 0)


if __name__ == '__main__':
    unittest.main()

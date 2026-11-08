"""Testy prep.py i build.py na sztucznej sieci z fixture.py.  Uruchom: python3 -m unittest discover tests"""
import base64
import gzip
import json
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)
import build  # noqa: E402
from fixture import make_gtfs, LINES  # noqa: E402
from prep import prepare  # noqa: E402


def write(path, text):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


class PrepTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        gtfs = make_gtfs(os.path.join(cls.tmp.name, 'gtfs'))
        cls.out = os.path.join(cls.tmp.name, 'data.json')
        cls.stats = prepare(gtfs, cls.out)
        with open(cls.out, encoding='utf-8') as f:
            cls.D = json.load(f)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_counts(self):
        s = self.stats
        self.assertEqual(s['routes'], 2)
        self.assertEqual(s['stops'], 6)
        self.assertEqual(s['skipped_trips'], 0)
        self.assertEqual(s['start'], '20260101')
        self.assertEqual(s['end'], '20261231')
        # A: 13 kursów w dni robocze + 7 w weekend, B: 13 + 7
        self.assertEqual(s['trips'], 40)

    def test_trips_sorted_and_times_consistent(self):
        starts = [t[6] for t in self.D['trips']]
        self.assertEqual(starts, sorted(starts))
        for route, service, pat, head, brig, tid, t0, deltas in self.D['trips']:
            self.assertTrue(all(d >= 0 for d in deltas), tid)
            stops = self.D['patterns'][pat][1]
            self.assertEqual(len(deltas) + 1, 2 * len(stops))

    def test_stop_distances_monotonic(self):
        for shape, stops, dists in self.D['patterns']:
            self.assertEqual(len(stops), len(dists))
            self.assertEqual(dists, sorted(dists))
            self.assertGreater(dists[-1] - dists[0], 2900)       # obie linie mają ok. 3 km

    def test_calendar(self):
        self.assertIn('POW', self.D['dates']['20261109'])      # poniedziałek
        self.assertEqual(self.D['dates']['20261108'], ['SW'])  # niedziela

    def test_streets(self):
        names = [n for n, _ in self.D['streets']]
        self.assertIn('Testowa', names)
        self.assertIn('Północna', names)

    def test_route_names(self):
        self.assertEqual([r['n'] for r in self.D['routes']], sorted(LINES))


class BuildTest(unittest.TestCase):
    def test_template_assembles(self):
        html = build.assemble(build.DEFAULT_TEMPLATE)
        self.assertEqual(html.count(build.PLACEHOLDER), 1)
        self.assertNotIn('@include', html)
        self.assertIn('function planRoute', html)
        self.assertTrue(html.rstrip().endswith('</html>'))

    def test_sources_list_every_module(self):
        files = build.sources(build.DEFAULT_TEMPLATE)
        js = sorted(os.path.relpath(p, os.path.join(ROOT, 'src')) for p in files if p.endswith('.js'))
        on_disk = sorted(os.path.join(d, f) for d in ('js', 'vendor') for f in os.listdir(os.path.join(ROOT, 'src', d)) if f.endswith('.js'))
        self.assertEqual(js, on_disk, 'każdy moduł z src/js musi być dołączony w src/index.html')

    def test_include_loop_detected(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = os.path.join(d, 'a.html'), os.path.join(d, 'b.html')
            write(a, 'x\n/*@include b.html*/\n')
            write(b, '/*@include a.html*/\n')
            with self.assertRaises(ValueError):
                build.assemble(a)

    def test_build_embeds_data(self):
        with tempfile.TemporaryDirectory() as d:
            dj, out = os.path.join(d, 'data.json'), os.path.join(d, 'index.html')
            with open(dj, 'w') as f:
                json.dump({'hello': 'świat'}, f)
            build.build(dj, build.DEFAULT_TEMPLATE, out)
            html = read(out)
            m = re.search(r'<script id="gtfs" type="application/octet-stream">([^<]*)</script>', html)
            self.assertTrue(m)
            self.assertEqual(json.loads(gzip.decompress(base64.b64decode(m.group(1)))), {'hello': 'świat'})


if __name__ == '__main__':
    unittest.main()

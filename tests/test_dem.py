"""Siatka wysokości (dem.py): wymiary, uzupełnianie braków, rzutowanie na układ strony."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import dem  # noqa: E402
from prep import proj, LAT0, LON0  # noqa: E402


class DemTest(unittest.TestCase):
    def test_grid_size(self):
        nx, ny = dem.grid_size([49.90, 21.78, 50.14, 22.26], 200)
        self.assertTrue(160 <= nx <= 180, nx)
        self.assertTrue(125 <= ny <= 140, ny)
        self.assertEqual(len(dem.grid_points([0, 0, 1, 1], 3, 2)), 6)

    def test_fill_missing(self):
        h = [200.0, None, 220.0]
        dem.fill(h)
        self.assertEqual(h, [200.0, 210.0, 220.0])

    def test_compact_relative_to_origin(self):
        # płaszczyzna rosnąca na wschód: 1 m na 0,001°; Rynek ma wysokość 0 po przeliczeniu
        bbox = [LAT0 - .01, LON0 - .01, LAT0 + .01, LON0 + .01]
        nx, ny = 21, 21
        pts = dem.grid_points(bbox, nx, ny)
        doc = {'bbox': bbox, 'nx': nx, 'ny': ny, 'h': [200 + (lo - bbox[1]) * 1000 for _, lo in pts]}
        c = dem.compact(doc, proj, (LAT0, LON0))
        self.assertAlmostEqual(c['base'], 210, places=1)
        self.assertEqual(c['h'][0], -100)              # 10 m niżej, w decymetrach
        self.assertEqual(c['h'][nx - 1], 100)
        x0, y0 = proj(bbox[0], bbox[1])
        self.assertAlmostEqual(c['x0'], round(x0, 1))
        self.assertAlmostEqual(c['dx'] * (nx - 1), proj(bbox[2], bbox[3])[0] - x0, places=0)


if __name__ == '__main__':
    unittest.main()

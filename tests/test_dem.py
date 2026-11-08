"""Siatka wysokości (dem.py): wymiary, uzupełnianie braków, rzutowanie na układ strony."""
import os
import struct
import sys
import unittest
import zlib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import dem  # noqa: E402
from prep import proj, LAT0, LON0  # noqa: E402


class DemTest(unittest.TestCase):
    def test_grid_size(self):
        nx, ny = dem.grid_size([49.90, 21.78, 50.14, 22.26], 150)
        self.assertEqual((nx, ny), (230, 178))
        self.assertEqual(len(dem.grid_points([0, 0, 1, 1], 3, 2)), 6)

    def test_terrarium_png_with_filters(self):
        # kafel 4×2: wysokości 100..107 m, wiersz 0 z filtrem Sub, wiersz 1 z filtrem Paeth
        w, hts = 4, [100 + i for i in range(8)]
        enc = lambda v: (int(v + 32768) // 256, int(v + 32768) % 256, 0)
        rows = [b''.join(bytes(enc(v)) for v in hts[r * w:(r + 1) * w]) for r in range(2)]

        def sub(line):
            return bytes((line[i] - (line[i - 3] if i >= 3 else 0)) & 255 for i in range(len(line)))

        def paeth(line, prev):
            out = []
            for i in range(len(line)):
                a, b, c = (line[i - 3] if i >= 3 else 0), prev[i], (prev[i - 3] if i >= 3 else 0)
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                out.append((line[i] - (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255)
            return bytes(out)
        raw = b'\x01' + sub(rows[0]) + b'\x04' + paeth(rows[1], rows[0])

        def chunk(kind, data):
            return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
        png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, 2, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
        size, h = dem.terrarium(png)
        self.assertEqual(size, 4)
        self.assertEqual(h, hts)

    def test_tile_coordinates(self):
        x, y = dem.tile_xy(50.0375, 22.0049, 11)
        self.assertEqual((int(x), int(y)), (1149, 694))   # kafel z Rynkiem

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

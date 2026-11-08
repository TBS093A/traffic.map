#!/usr/bin/env python3
"""Generuje ikony aplikacji (pixel-art autobus) do src/static/ — PNG z biblioteki standardowej.

Użycie: python3 tools/make_icons.py
Ikony mają margines, więc nadają się też jako "maskable" (system może przyciąć je do koła).
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = """
................
................
..YYYYYYYYYYYY..
.YYYYYYYYYYYYYY.
.YWWWYWWWYWWWYY.
.YWWWYWWWYWWWYY.
.YWWWYWWWYWWWYY.
.YYYYYYYYYYYYYY.
.YRRRRRRRRRRRRY.
.YLYYYYYYYYYYLY.
.YYYYYYYYYYYYYY.
..KK........KK..
..KK........KK..
................
""".strip().split('\n')
COLORS = {'.': (0x14, 0x16, 0x22), 'Y': (0xf2, 0xd1, 0x6b), 'W': (0x3f, 0x6f, 0x9e), 'K': (0x0f, 0x0e, 0x17),
          'L': (0xff, 0xee, 0xaa), 'R': (0xa8, 0x50, 0x3a)}


def png(path, size):
    rows_art, cols = len(ART), len(ART[0])
    scale = int(size * 0.8) // cols
    ox, oy = (size - cols * scale) // 2, (size - rows_art * scale) // 2
    bg = COLORS['.']
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        ay = (y - oy) // scale
        for x in range(size):
            ax = (x - ox) // scale
            c = COLORS[ART[ay][ax]] if 0 <= ay < rows_art and 0 <= ax < cols and y >= oy and x >= ox else bg
            raw += bytes(c)

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    body = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + \
        chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(body)


if __name__ == '__main__':
    out = os.path.join(ROOT, 'src', 'static')
    os.makedirs(out, exist_ok=True)
    for s in (192, 512):
        png(os.path.join(out, f'icon-{s}.png'), s)
    png(os.path.join(out, 'apple-touch-icon.png'), 180)
    print('ikony w', out)

#!/usr/bin/env python3
"""Model wysokości terenu (DEM) dla mapy: siatka wysokości nad obszarem sieci.

Źródło: Terrain Tiles (Mapzen, AWS Open Data) w formacie Terrarium: kafle PNG, w których kolor koduje
wysokość: h = R·256 + G + B/256 − 32768 [m]. Bez klucza; na obszar sieci ZTM wystarczy kilkanaście kafli
w zoomie 11 (ok. 75 m na piksel). W Europie dane pochodzą m.in. z EU-DEM (Copernicus) i SRTM (NASA).
Kafle są dekodowane biblioteką standardową (zlib) i próbkowane dwuliniowo w regularnej siatce.

Plik cache (work/cache/dem.json.gz): {"bbox": [płd, zach, płn, wsch], "nx", "ny", "h": [m, wierszami od południa]}.
"""
import gzip
import json
import math
import os
import struct
import time
import urllib.request
import zlib

TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
SOURCE = 'Terrain Tiles (Mapzen, AWS Open Data): EU-DEM (Copernicus), SRTM (NASA) i inne'


def grid_size(bbox, step_m):
    s, w, n, e = bbox
    lat0 = (s + n) / 2
    ny = max(2, round((n - s) * 110574 / step_m) + 1)
    nx = max(2, round((e - w) * 111320 * math.cos(math.radians(lat0)) / step_m) + 1)
    return nx, ny


def grid_points(bbox, nx, ny):
    s, w, n, e = bbox
    return [(s + (n - s) * j / (ny - 1), w + (e - w) * i / (nx - 1)) for j in range(ny) for i in range(nx)]


# ---------------------------------------------------------------- kafle WebMercator
def tile_xy(lat, lon, z):
    """Współrzędne kafla jako liczby rzeczywiste (część ułamkowa = położenie w kaflu)."""
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def decode_png(data):
    """PNG 8 bit RGB/RGBA bez przeplotu -> (szerokość, wysokość, kanały, bajty pikseli wierszami)."""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('to nie jest PNG')
    pos, idat, w = 8, b'', None
    while pos < len(data):
        n, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if kind == b'IHDR':
            w, h, depth, ctype, _, _, interlace = struct.unpack('>IIBBBBB', body)
            if depth != 8 or ctype not in (2, 6) or interlace:
                raise ValueError(f'nieobsługiwany PNG (głębia {depth}, typ {ctype}, przeplot {interlace})')
            ch = 3 if ctype == 2 else 4
        elif kind == b'IDAT':
            idat += body
        elif kind == b'IEND':
            break
        pos += 12 + n
    raw, stride = zlib.decompress(idat), w * ch
    out, prev = bytearray(stride * h), bytearray(stride)
    for y in range(h):
        f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - ch] if i >= ch else 0
            b, c = prev[i], prev[i - ch] if i >= ch else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, ch, out


def terrarium(png):
    """Kafel Terrarium -> (rozmiar, lista wysokości [m] wierszami od góry)."""
    w, h, ch, px = decode_png(png)
    return w, [px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768 for i in range(0, w * h * ch, ch)]


def fetch(bbox, step_m, url=TILES, user_agent='rzeszow-w-pikselach', pause_s=0.2, retries=3, timeout=60, log=None, zoom=11):
    """Pobiera kafle pokrywające bbox i próbkuje z nich siatkę wysokości. Zwraca słownik gotowy do zapisu."""
    s, w, n, e = bbox
    x0, y1 = tile_xy(s, w, zoom)
    x1, y0 = tile_xy(n, e, zoom)
    tiles = {}
    for ty in range(int(y0), int(y1) + 1):
        for tx in range(int(x0), int(x1) + 1):
            for attempt in range(1, retries + 1):
                try:
                    req = urllib.request.Request(url.format(z=zoom, x=tx, y=ty), headers={'User-Agent': user_agent})
                    with urllib.request.urlopen(req, timeout=timeout) as r:
                        tiles[(tx, ty)] = terrarium(r.read())
                    break
                except Exception as err:  # noqa: BLE001
                    if attempt == retries:
                        raise
                    if log:
                        log.info('wysokości terenu, kafel %d/%d: %s — ponawiam (%d/%d)', tx, ty, err, attempt, retries)
                    time.sleep(pause_s * 10 * attempt)
            time.sleep(pause_s)

    def px(gx, gy):                                       # piksel w globalnych współrzędnych zoomu
        size = next(iter(tiles.values()))[0]
        tx, ty = int(gx // size), int(gy // size)
        t = tiles.get((tx, ty))
        if t is None:
            return None
        return t[1][int(gy - ty * size) * size + int(gx - tx * size)]

    size = next(iter(tiles.values()))[0]
    nx, ny = grid_size(bbox, step_m)
    h = []
    for la, lo in grid_points(bbox, nx, ny):
        fx, fy = tile_xy(la, lo, zoom)
        gx, gy = fx * size - .5, fy * size - .5
        ix, iy = math.floor(gx), math.floor(gy)
        u, v = gx - ix, gy - iy
        q = [px(ix, iy), px(ix + 1, iy), px(ix, iy + 1), px(ix + 1, iy + 1)]
        if any(c is None for c in q):
            h.append(None)
            continue
        h.append(round((q[0] * (1 - u) + q[1] * u) * (1 - v) + (q[2] * (1 - u) + q[3] * u) * v, 1))
    fill(h)
    return {'bbox': list(bbox), 'nx': nx, 'ny': ny, 'h': h, 'source': SOURCE, 'tiles': len(tiles), 'zoom': zoom}


def fill(h):
    """Braki (None) zastępuje średnią znanych wartości."""
    known = [v for v in h if v is not None]
    avg = sum(known) / len(known) if known else 0
    for i, v in enumerate(h):
        if v is None:
            h[i] = avg


def load(path):
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        return json.load(f)


def save(doc, path):
    tmp = path + '.part'
    with gzip.open(tmp, 'wt', encoding='utf-8') as f:
        json.dump(doc, f, separators=(',', ':'))
    os.replace(tmp, path)


def compact(doc, proj, origin_latlon):
    """Siatka w lokalnym układzie strony: początek, krok, rozmiar i wysokości [dm] względem punktu odniesienia
    (Rynek = 0), żeby podpisy i kamera zostały blisko zera."""
    s, w, n, e = doc['bbox']
    nx, ny, h = doc['nx'], doc['ny'], doc['h']
    x0, y0 = proj(s, w)
    x1, y1 = proj(n, e)
    dx, dy = (x1 - x0) / (nx - 1), (y1 - y0) / (ny - 1)
    ox, oy = proj(*origin_latlon)
    fi, fj = (ox - x0) / dx, (oy - y0) / dy
    i, j = min(max(int(fi), 0), nx - 2), min(max(int(fj), 0), ny - 2)
    u, v = fi - i, fj - j
    at = lambda a, b: h[b * nx + a]
    base = (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v
    return {'x0': round(x0, 1), 'y0': round(y0, 1), 'dx': round(dx, 3), 'dy': round(dy, 3), 'nx': nx, 'ny': ny,
            'base': round(base, 1), 'h': [round((v - base) * 10) for v in h]}

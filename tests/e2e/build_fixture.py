#!/usr/bin/env python3
"""Buduje stronę z sztucznej sieci testowej do katalogu out (bez pobierania danych).

Użycie: python3 tests/e2e/build_fixture.py <katalog_wyjściowy>
"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'tests'))
from build import build, DEFAULT_TEMPLATE, write_extras  # noqa: E402
from fixture import make_gtfs  # noqa: E402
from prep import prepare  # noqa: E402

out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'dist-test')
os.makedirs(out, exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    data = os.path.join(tmp, 'data.json')
    prepare(make_gtfs(os.path.join(tmp, 'gtfs')), data)
    build(data, DEFAULT_TEMPLATE, os.path.join(out, 'index.html'))
    write_extras(out, version='test')
print(out)

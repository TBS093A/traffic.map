#!/usr/bin/env python3
"""Składa index.html: wkleja skompresowane dane (gzip + base64) do szablonu strony.

Użycie jako skrypt:  python3 build.py [data.json] [index.src.html] [index.html]
Użycie jako moduł:   from build import build; build('data.json', 'index.src.html', 'index.html')
"""
import base64
import gzip
import sys

PLACEHOLDER = '/*__DATA__*/'


def build(data_json, template, out):
    with open(data_json, 'rb') as f:
        packed = base64.b64encode(gzip.compress(f.read(), compresslevel=9, mtime=0)).decode()
    with open(template, encoding='utf-8') as f:
        src = f.read()
    if src.count(PLACEHOLDER) != 1:
        raise ValueError(f'szablon musi zawierać dokładnie jeden znacznik {PLACEHOLDER}')
    html = src.replace(PLACEHOLDER, packed)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    return len(html)


if __name__ == '__main__':
    a = sys.argv[1:] + [None] * 3
    print(build(a[0] or 'data.json', a[1] or 'index.src.html', a[2] or 'index.html'), 'bajtów')

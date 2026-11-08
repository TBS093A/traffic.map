#!/usr/bin/env python3
"""Składa index.html: skleja moduły szablonu i wkleja skompresowane dane (gzip + base64).

Szablon (domyślnie src/index.html) może dołączać inne pliki liniami w postaci
    /*@include js/plik.js*/
Ścieżki są względne wobec katalogu szablonu. Linia ze znacznikiem jest zastępowana treścią pliku.

Użycie jako skrypt:  python3 build.py [data.json] [src/index.html] [index.html]
Użycie jako moduł:   from build import build; build('data.json', 'src/index.html', 'index.html')
"""
import base64
import gzip
import os
import re
import sys

PLACEHOLDER = '/*__DATA__*/'
INCLUDE = re.compile(r'^\s*/\*@include\s+(\S+?)\s*\*/\s*$')
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TEMPLATE = os.path.join(HERE, 'src', 'index.html')


def assemble(template, _seen=None):
    """Treść szablonu z rozwiniętymi znacznikami @include (rekurencyjnie)."""
    seen = _seen or set()
    path = os.path.abspath(template)
    if path in seen:
        raise ValueError(f'zapętlone dołączanie: {template}')
    seen = seen | {path}
    base = os.path.dirname(path)
    with open(path, encoding='utf-8') as f:
        lines = f.read().split('\n')
    out = []
    for line in lines:
        m = INCLUDE.match(line)
        if not m:
            out.append(line)
            continue
        part = assemble(os.path.join(base, m.group(1)), seen)
        out.append(part[:-1] if part.endswith('\n') else part)
    return '\n'.join(out)


def sources(template):
    """Lista plików, z których powstaje strona (szablon i wszystko, co dołącza)."""
    path = os.path.abspath(template)
    found = [path]
    with open(path, encoding='utf-8') as f:
        for line in f:
            m = INCLUDE.match(line.rstrip('\n'))
            if m:
                found += sources(os.path.join(os.path.dirname(path), m.group(1)))
    return found


def build(data_json, template, out):
    with open(data_json, 'rb') as f:
        packed = base64.b64encode(gzip.compress(f.read(), compresslevel=9, mtime=0)).decode()
    src = assemble(template)
    if src.count(PLACEHOLDER) != 1:
        raise ValueError(f'szablon musi zawierać dokładnie jeden znacznik {PLACEHOLDER}')
    html = src.replace(PLACEHOLDER, packed)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    return len(html)


if __name__ == '__main__':
    a = sys.argv[1:] + [None] * 3
    print(build(a[0] or 'data.json', a[1] or DEFAULT_TEMPLATE, a[2] or 'index.html'), 'bajtów')

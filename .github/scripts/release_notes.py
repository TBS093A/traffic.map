#!/usr/bin/env python3
"""Notatki do wydania z listy zmergowanych PR-ów (JSON z `gh pr list --json number,title,labels,author,url`).

Grupy według etykiet: feature/enhancement -> Nowości, bug/fix -> Poprawki, security -> Bezpieczeństwo,
docs -> Dokumentacja, ci/build/deps -> Zaplecze, reszta -> Inne. PR-y z etykietą skip-changelog są pomijane.

Użycie: release_notes.py <prs.json> <wersja> [poprzedni_tag] > notes.md
"""
import json
import sys

GROUPS = [
    ('Nowości', {'feature', 'enhancement', 'feat'}),
    ('Poprawki', {'bug', 'fix', 'bugfix'}),
    ('Bezpieczeństwo', {'security'}),
    ('Dokumentacja', {'docs', 'documentation'}),
    ('Zaplecze', {'ci', 'build', 'deps', 'dependencies', 'chore', 'refactor', 'tests'}),
]
SKIP = {'skip-changelog', 'bot'}


def group_of(labels):
    names = {lbl.lower() for lbl in labels}
    for title, keys in GROUPS:
        if names & keys:
            return title
    return 'Inne'


def notes(prs, version, prev=None, repo=None):
    groups = {}
    for pr in sorted(prs, key=lambda p: p['number']):
        labels = [lbl['name'] for lbl in pr.get('labels', [])]
        if SKIP & {lbl.lower() for lbl in labels}:
            continue
        author = (pr.get('author') or {}).get('login', '')
        line = f"- {pr['title']} (#{pr['number']}{', @' + author if author and not author.endswith('[bot]') else ''})"
        groups.setdefault(group_of(labels), []).append(line)
    out = [f'## {version}', '']
    order = [g for g, _ in GROUPS] + ['Inne']
    for g in order:
        if g in groups:
            out += [f'### {g}', *groups[g], '']
    if not groups:
        out += ['Brak zmian opisanych w PR-ach.', '']
    if prev and repo:
        out.append(f'Pełna lista zmian: https://github.com/{repo}/compare/{prev}...{version}')
    out += ['', 'Do wydania dołączona jest gotowa strona `index.html` z rozkładem i mapą z dnia budowy.',
            'Dane: ZTM Rzeszów (przetworzone), © współtwórcy OpenStreetMap (ODbL).']
    return '\n'.join(out) + '\n'


if __name__ == '__main__':
    with open(sys.argv[1], encoding='utf-8') as f:
        prs = json.load(f)
    prev = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
    import os
    sys.stdout.write(notes(prs, sys.argv[2], prev, os.environ.get('GITHUB_REPOSITORY')))

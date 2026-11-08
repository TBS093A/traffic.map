"""Notatki do wydania z listy PR-ów (.github/scripts/release_notes.py)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.github', 'scripts'))
from release_notes import notes  # noqa: E402


def pr(n, title, *labels, author='ania'):
    return {'number': n, 'title': title, 'labels': [{'name': x} for x in labels], 'author': {'login': author}, 'url': ''}


class ReleaseNotesTest(unittest.TestCase):
    def test_groups_by_label(self):
        md = notes([pr(3, 'Pogoda w panelu', 'feature'), pr(1, 'Poprawka planera', 'bug'), pr(2, 'Coś innego')], 'v1.0.0')
        self.assertLess(md.index('### Nowości'), md.index('### Poprawki'))
        self.assertLess(md.index('### Poprawki'), md.index('### Inne'))
        self.assertIn('- Pogoda w panelu (#3, @ania)', md)

    def test_skips_bots_and_skip_label(self):
        md = notes([pr(4, 'Odświeżone screeny', 'bot', author='github-actions[bot]'), pr(5, 'Tylko CI', 'skip-changelog')], 'v1.0.1')
        self.assertNotIn('#4', md)
        self.assertNotIn('#5', md)
        self.assertIn('Brak zmian', md)

    def test_compare_link(self):
        md = notes([], 'v1.1.0', 'v1.0.0', 'TBS093A/traffic.map')
        self.assertIn('compare/v1.0.0...v1.1.0', md)


if __name__ == '__main__':
    unittest.main()

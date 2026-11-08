// Pełny rozkład przystanku.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureData, loadApp, hm } from './harness.mjs';

const D = fixtureData();
const app = loadApp(D);
const group = name => app.S.groups.find(g => g.name === name);

test('dzień roboczy: linia A z Zachodu co 10 min od 6:00 do 8:00', () => {
  const blocks = app.timetableFor(group('Zachód').members, ['POW']);
  assert.equal(blocks.length, 1);
  assert.equal(D.routes[blocks[0].route].n, 'A');
  assert.equal(blocks[0].deps.length, 13);
  assert.equal(blocks[0].deps[0], hm('06:00'));
  assert.equal(blocks[0].deps.at(-1), hm('08:00'));
});

test('weekend: co drugi kurs', () => {
  assert.equal(app.timetableFor(group('Zachód').members, ['SW'])[0].deps.length, 7);
});

test('przystanek końcowy nie ma odjazdów, przesiadkowy ma linię B', () => {
  assert.equal(app.timetableFor(group('Daleko').members, ['POW']).length, 0);
  const c = app.timetableFor(group('Centrum').members, ['POW']);
  assert.deepEqual(Array.from(c.map(b => D.routes[b.route].n)), ['B']);
});

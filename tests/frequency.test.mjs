// Częstotliwość kursów i zasięg (izochrony) na sieci testowej.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureData, loadApp, hm } from './harness.mjs';

const D = fixtureData();
const app = loadApp(D);
const MON = '20261109';
const group = name => app.S.groups.find(g => g.name === name);
const shapeOf = n => app.S.trips.find(t => D.routes[t.route].n === n).shape;

test('kursy na godzinę: A co 10 min, B co 15 min', () => {
  const f = app.routeFrequency(MON, hm('07:00'));
  assert.equal(f.get(shapeOf('A')), 6);       // okno [6:30, 7:30): 6:30, 6:40, …, 7:20
  assert.ok(f.get(shapeOf('B')) >= 4 && f.get(shapeOf('B')) <= 5);
  assert.equal(app.routeFrequency(MON, hm('13:00')).size, 0, 'po południu w sieci testowej nic nie jeździ');
});

test('zasięg z Zachodu o 6:00: Centrum po 10 min, Daleko po 23 min, pod prąd tylko pieszo', () => {
  const t = app.reachFrom({ kind: 'stop', g: group('Zachód').id, label: 'Zachód' }, MON, hm('06:00'), 2700);
  const at = name => Math.min(...group(name).members.map(m => t[m]));
  assert.equal(at('Środek'), 300);
  assert.equal(at('Centrum'), 600);
  assert.equal(at('Daleko'), 23 * 60);
  assert.ok(at('Północ') < at('Daleko'));
});

test('zasięg ograniczony czasem', () => {
  const t = app.reachFrom({ kind: 'stop', g: group('Zachód').id, label: 'Zachód' }, MON, hm('06:00'), 900);
  assert.equal(Math.min(...group('Daleko').members.map(m => t[m])), Infinity);
});

// Linki do widoku: zapis i odczyt stanu w części # adresu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureData, loadApp, hm } from './harness.mjs';

const D = fixtureData();
const app = loadApp(D);
const group = name => app.S.groups.find(g => g.name === name);

test('przystanek ze słupkiem i kamera przechodzą przez link', () => {
  const c = group('Centrum'), m = c.members[1];
  const h = app.encodeLink({ stop: m, side: m, route: -1, trip: -1, cam: { x: 12.4, z: -30.6, yaw: Math.PI / 4 + Math.PI, half: 400 } });
  assert.match(h, /s=Centrum/);
  assert.match(h, /v=12,-31,2,400/);
  const st = app.decodeLink('#' + h);
  assert.equal(st.stop, m);
  assert.equal(st.side, m);
  assert.ok(Math.abs(st.cam.yaw - (Math.PI / 4 + Math.PI)) < 1e-9);
});

test('linia i kurs zapisane nazwami', () => {
  const ti = 3, tr = app.S.trips[ti];
  const st = app.decodeLink('#' + app.encodeLink({ stop: -1, route: tr.route, trip: ti }));
  assert.equal(st.route, tr.route);
  assert.equal(st.trip, ti);
});

test('trasa planera: przystanek i punkt z lat/lon', () => {
  const from = { kind: 'stop', g: group('Zachód').id, label: 'Zachód' };
  const to = { kind: 'point', x: 100, y: 2900, label: 'Dom, ul. Północna' };
  const h = app.encodeLink({ stop: -1, route: -1, trip: -1, from, to, at: hm('07:30') });
  const st = app.decodeLink(h);
  assert.equal(st.from.kind, 'stop');
  assert.equal(st.from.g, from.g);
  assert.equal(st.to.label, 'Dom, ul. Północna');
  assert.ok(Math.hypot(st.to.x - 100, st.to.y - 2900) < 2, 'dokładność ok. 1 m');
  assert.equal(st.at, hm('07:30'));
});

test('nieznane nazwy i śmieci w linku są pomijane', () => {
  const st = app.decodeLink('#s=Nieistnieje&l=999&t=xyz&v=1,2,3&from=q:abc&time=99:99');
  assert.equal(st.stop, -1);
  assert.equal(st.route, -1);
  assert.equal(st.trip, -1);
  assert.equal(st.cam, undefined);
  assert.equal(st.from, null);
  assert.equal(st.time, null);
});

test('wielkość liter i polskie znaki w nazwie przystanku', () => {
  assert.equal(app.decodeLink('#s=zachod').stop, group('Zachód').members[0]);
});

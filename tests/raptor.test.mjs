// Testy planera RAPTOR, grup przystanków i geokodera na sztucznej sieci.  Uruchom: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureData, loadApp, hm } from './harness.mjs';

const D = fixtureData();
const app = loadApp(D);
const MON = '20261109', SUN = '20261108';
const group = name => app.S.groups.find(g => g.name === name);
const stopP = name => ({ kind: 'stop', g: group(name).id, label: name });
const rides = o => o.legs.filter(l => l.type === 'ride');
const arr = a => Array.from(a);   // tablice z kontekstu vm mają inny prototyp

test('przystanki o tej samej nazwie tworzą jedną grupę', () => {
  const c = group('Centrum');
  assert.ok(c, 'brak grupy Centrum');
  assert.equal(c.members.length, 2);
  assert.deepEqual(arr(c.routeList.map(r => D.routes[r].n)), ['A', 'B']);
});

test('dojazd bez przesiadki', () => {
  const res = app.planRoute(stopP('Zachód'), stopP('Centrum'), MON, hm('06:00'));
  const best = res.find(o => o.rides === 1);
  assert.ok(best);
  assert.equal(best.dep, hm('06:00'));
  assert.equal(best.arr, hm('06:10'));
  assert.equal(D.routes[rides(best)[0].route].n, 'A');
});

test('przesiadka z przejściem między słupkami', () => {
  const res = app.planRoute(stopP('Zachód'), stopP('Daleko'), MON, hm('06:00'));
  assert.equal(res.length, 1, 'tylko jeden sensowny wariant');
  const o = res[0];
  assert.equal(o.transfers, 1);
  assert.deepEqual(arr(rides(o).map(l => D.routes[l.route].n)), ['A', 'B']);
  assert.equal(rides(o)[1].dep, hm('06:15'), 'B o 6:00 już odjechał, następny 6:15');
  assert.equal(o.arr, hm('06:23'));
  assert.ok(o.legs.some(l => l.type === 'walk'), 'przejście Centrum 01 → Centrum 02');
});

test('w niedzielę kursy co drugi', () => {
  const res = app.planRoute(stopP('Zachód'), stopP('Centrum'), SUN, hm('06:05'));
  const best = res.find(o => o.rides === 1);
  assert.equal(best.dep, hm('06:20'));
});

test('pod prąd linii zostaje tylko spacer', () => {
  const res = app.planRoute(stopP('Środek'), stopP('Zachód'), MON, hm('07:00'));
  assert.equal(res.length, 1);
  assert.equal(res[0].rides, 0);
  assert.ok(res[0].arr - res[0].dep > 20 * 60, '1,5 km pieszo to ponad 20 min');
});

test('po ostatnim kursie nie ma połączenia', () => {
  const res = app.planRoute(stopP('Zachód'), stopP('Daleko'), MON, hm('23:00'));
  assert.equal(res.length, 0);
});

test('adres jako punkt: dojście pieszo do przystanku', () => {
  const from = { kind: 'point', x: -2950, y: 80, label: 'blisko Zachodu' };
  const res = app.planRoute(from, stopP('Centrum'), MON, hm('06:00'));
  const o = res.find(o => o.rides === 1);
  assert.equal(o.legs[0].type, 'walk');
  assert.equal(rides(o)[0].dep, hm('06:10'), 'dojście trwa ok. 2 min, więc łapie kurs 6:10');
});

test('geokoder znajduje ulicę z danych przystanków, bez polskich znaków', () => {
  const r = app.geocode('polnocna');
  assert.ok(r.length);
  assert.equal(r[0].label, 'Północna');
  assert.equal(r[0].kind, 'area');
});

test('kalendarz: daty spoza feedu dostają rozkład wzorcowy', () => {
  const a = app.servicesFor('20270104');
  assert.equal(a.fallback, true);
  assert.deepEqual(arr(a.svs), ['POW']);
  assert.deepEqual(arr(app.servicesFor(SUN).svs), ['SW']);
});

test('pozycja kursu w czasie', () => {
  const ti = app.S.trips.findIndex(t => D.routes[t.route].n === 'A' && t.start === hm('06:00'));
  const tr = app.S.trips[ti];
  assert.equal(app.tripDist(tr, hm('05:59')).k, 0);
  const mid = app.tripDist(tr, hm('06:02') + 30);
  assert.equal(mid.at, false);
  assert.ok(mid.d > tr.dist[0] && mid.d < tr.dist[1]);
  assert.equal(app.tripDist(tr, hm('06:30')).k, 2);
});

// Tryby (autobusy, pociągi, samoloty, infrastruktura), samoloty z proxy i jakość powietrza.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureData, loadApp } from './harness.mjs';
import { aircraftFrom, handler } from '../proxy.mjs';

const D = fixtureData();
const app = loadApp(D);

test('tryb i warstwy w linku: domyślne pomijane, inne zapisane', () => {
  assert.equal(app.modesCode(), 'brai');
  assert.equal(app.uiMode, 'bus');
  const def = app.encodeLink({ stop: -1, route: -1, trip: -1, modes: 'brai', mode: 'bus' });
  assert.ok(!def.includes('m=') && !def.includes('mode='));
  assert.match(app.encodeLink({ stop: -1, route: -1, trip: -1, modes: 'ri', mode: 'air' }), /mode=air&m=ri/);
  assert.equal(app.decodeLink('#m=ri').modes, 'ri');
  assert.equal(app.decodeLink('#mode=rail').mode, 'rail');
  assert.equal(app.decodeLink('#mode=boat').mode, undefined);
  assert.equal(app.decodeLink('#m=x<y').modes, undefined);
  assert.deepEqual({ ...app.modesFromCode('ri') }, { bus: false, rail: true, air: false, infra: true });
  assert.deepEqual({ ...app.modesFromCode('-') }, { bus: false, rail: false, air: false, infra: false });
});

test('sieć testowa nie ma pociągów: wszystkie linie to autobusy, planer je bierze', () => {
  assert.ok(D.routes.every(r => r.m === undefined));
  assert.ok(D.routes.every((_, r) => app.routeOn(r) && app.planRouteOk(r)));
});

test('samoloty: odpowiedź adsb.lol w jednostkach SI', () => {
  const list = aircraftFrom({ ac: [
    { hex: '48af0c', flight: 'LOT191  ', r: 'SP-LVM', t: 'B38M', lat: 50.1, lon: 22.0, alt_baro: 30625, alt_geom: 31000, gs: 458, track: 171.7, baro_rate: 704, squawk: '2000' },
    { hex: 'aaa', lat: 50.11, lon: 22.03, alt_baro: 'ground', gs: 10 },
    { hex: 'bez-pozycji', alt_baro: 1000 },
  ] });
  assert.equal(list.length, 2);
  assert.deepEqual([list[0].flight, list[0].reg, list[0].alt, list[0].gs], ['LOT191', 'SP-LVM', 9449, 848]);
  assert.equal(list[0].vr, 3.6);
  assert.ok(list[1].gnd);
  assert.equal(list[1].alt, 0);
  assert.deepEqual(aircraftFrom(null), []);
});

test('proxy: /aircraft.json z bieżącego stanu', async () => {
  const h = handler(() => ({}), async () => ({ timestamp: 1, aircraft: [{ hex: 'x' }] }));
  let status, body = '';
  await h({ method: 'GET', url: '/aircraft.json' }, { writeHead: s => { status = s; }, end: b => { body = b; } });
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(body).aircraft, [{ hex: 'x' }]);
});

test('jakość powietrza: indeks EAQI i opis', () => {
  assert.deepEqual({ ...app.parseAir({ current: { european_aqi: 35, pm10: 20.1, pm2_5: 12.4 } }) }, { aqi: 35, pm10: 20.1, pm25: 12.4, label: 'dobra' });
  assert.equal(app.parseAir({ current: { european_aqi: 120 } }).label, 'bardzo zła');
  assert.equal(app.parseAir({}), null);
});

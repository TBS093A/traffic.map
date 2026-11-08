// Pogoda (odpowiedź Open-Meteo) i pora roku z daty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureData, loadApp } from './harness.mjs';

const opt = { wx: 'off', season: 'auto' };
const app = loadApp(fixtureData(), { opt });

test('odpowiedź Open-Meteo: bieżąca pogoda i wschody/zachody', () => {
  const w = app.parseWeather({
    current: { temperature_2m: 6.4, apparent_temperature: 3.1, weather_code: 61, precipitation: 0.8, cloud_cover: 90, wind_speed_10m: 18, snow_depth: 0, time: '2026-11-08T16:00' },
    daily: { time: ['2026-11-08', '2026-11-09'], sunrise: ['2026-11-08T06:42', '2026-11-09T06:44'], sunset: ['2026-11-08T16:03', '2026-11-09T16:01'] },
  });
  assert.equal(w.cur.temp, 6.4);
  assert.equal(w.cur.code, 61);
  assert.ok(Math.abs(w.days['20261108'][0] - 6.7) < 1e-9);
  assert.ok(Math.abs(w.days['20261109'][1] - (16 + 1 / 60)) < 1e-9);
});

test('kody WMO po polsku', () => {
  assert.equal(app.wmo(0)[1], 'bezchmurnie');
  assert.equal(app.wmo(65)[1], 'ulewa');
  assert.equal(app.wmo(73)[1], 'śnieg');
  assert.equal(app.wmo(95)[1], 'burza');
});

test('pora roku z daty: lato, jesień, zima', () => {
  const s = ymd => app.seasonState({ ymd });
  assert.deepEqual({ ...s('20260715') }, { autumn: 0, winter: 0, snow: 0 });
  assert.equal(s('20261025').autumn, 1);
  assert.equal(s('20260115').winter, 1);
  assert.ok(s('20261130').autumn > 0 && s('20261130').winter > 0, 'listopad: przejście');
});

test('pora roku wymuszona w ustawieniach', () => {
  opt.season = 'winter';
  assert.equal(app.seasonState({ ymd: '20260715' }).snow, .85);
  opt.season = 'auto';
});

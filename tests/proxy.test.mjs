// Serwer z proxy.mjs: pliki tylko z katalogu strony, nagłówki bezpieczeństwa, dekoder protobuf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { staticPath, SECURITY_HEADERS, feedToJson, merge } from '../proxy.mjs';

const dist = path.resolve('/srv/rwp/dist');

test('ścieżki: strona i pliki obok niej', () => {
  assert.equal(staticPath('/', dist), path.join(dist, 'index.html'));
  assert.equal(staticPath('/sw.js?v=2', dist), path.join(dist, 'sw.js'));
  assert.equal(staticPath('/manifest.webmanifest', dist), path.join(dist, 'manifest.webmanifest'));
});

test('ścieżki: nic spoza katalogu, bez plików ukrytych i nieznanych typów', () => {
  for (const u of ['/../pipeline.py', '/..%2f..%2fetc%2fpasswd', '/.index.html.tmp', '/.git/config', '/x.py', '/%E0%A4%A']) assert.equal(staticPath(u, dist), null, u);
  // parser URL sam rozwiązuje /%2e%2e/, więc wynik zostaje w katalogu strony
  for (const u of ['/%2e%2e/secret.json', '/a/../../../b.json']) { const f = staticPath(u, dist); assert.ok(f === null || f.startsWith(dist + path.sep), u); }
});

test('nagłówki bezpieczeństwa', () => {
  assert.match(SECURITY_HEADERS['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
});

// minimalny koder protobuf do zbudowania testowej wiadomości
const varint = n => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; o.push(b); } while (n); return o; };
const field = (no, wt, payload) => [...varint(no * 8 + wt), ...payload];
const str = (no, s) => { const b = [...Buffer.from(s)]; return field(no, 2, [...varint(b.length), ...b]); };
const msg = (no, parts) => field(no, 2, [...varint(parts.length), ...parts]);
const f32 = (no, v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return field(no, 5, [...b]); };

test('dekoder GTFS-Realtime: pozycja pojazdu', () => {
  const vehicle = [...msg(1, str(1, 'T-1')), ...msg(2, [...f32(1, 50.04), ...f32(2, 22.0)]), ...field(5, 0, varint(1762600000)), ...msg(8, str(2, '1234'))];
  const buf = Buffer.from([...msg(1, field(3, 0, varint(1762600005))), ...msg(2, [...str(1, 'e1'), ...msg(4, vehicle)])]);
  const j = feedToJson(buf);
  assert.equal(j.timestamp, 1762600005);
  assert.equal(j.vehicles.length, 1);
  const v = j.vehicles[0];
  assert.equal(v.tripId, 'T-1');
  assert.equal(v.label, '1234');
  assert.ok(Math.abs(v.lat - 50.04) < 1e-5);
});

// int32 ze znakiem: ujemne jako 10-bajtowy varint
const sint = (no, n) => field(no, 0, n >= 0 ? varint(n) : (() => { let v = BigInt.asUintN(64, BigInt(n)); const o = []; do { let b = Number(v & 127n); v >>= 7n; if (v) b |= 128; o.push(b); } while (v); return o; })());

test('dekoder GTFS-Realtime: prognoza kursu z ujemnym opóźnieniem i odwołany kurs', () => {
  const stu = [...field(1, 0, varint(3)), ...msg(3, sint(1, -90)), ...str(4, 'C1')];
  const tu = [...msg(1, str(1, 'T-2')), ...msg(2, stu), ...sint(5, 120)];
  const canceled = msg(1, [...str(1, 'T-3'), ...field(4, 0, varint(3))]);
  const buf = Buffer.from([...msg(2, [...str(1, 'e2'), ...msg(3, tu)]), ...msg(2, [...str(1, 'e3'), ...msg(3, canceled)])]);
  const { trips } = feedToJson(buf);
  assert.equal(trips.length, 2);
  assert.equal(trips[0].tripId, 'T-2');
  assert.equal(trips[0].delay, 120);
  assert.equal(trips[0].stops[0].depDelay, -90);
  assert.equal(trips[0].stops[0].stopId, 'C1');
  assert.equal(trips[1].canceled, true);
});

test('dekoder GTFS-Realtime: komunikat o utrudnieniu', () => {
  const tr = (s, lang) => msg(1, [...str(1, s), ...str(2, lang)]);
  const alert = [...msg(1, [...field(1, 0, varint(100)), ...field(2, 0, varint(200))]), ...msg(5, str(2, 'A')), ...msg(5, str(5, 'W')),
    ...field(7, 0, varint(4)), ...msg(10, [...tr('Detour', 'en'), ...tr('Objazd', 'pl')]), ...msg(11, tr('Remont mostu', 'pl'))];
  const { alerts } = feedToJson(Buffer.from(msg(2, [...str(1, 'a1'), ...msg(5, alert)])));
  assert.equal(alerts.length, 1);
  const a = alerts[0];
  assert.equal(a.header, 'Objazd');
  assert.equal(a.description, 'Remont mostu');
  assert.equal(a.effect, 'objazd');
  assert.deepEqual(a.routes, ['A']);
  assert.deepEqual(a.stops, ['W']);
  assert.deepEqual(a.periods, [[100, 200]]);
});

test('łączenie kanałów: błąd jednego nie gasi pozostałych', () => {
  const m = merge([{ timestamp: 5, vehicles: [1], trips: [], alerts: [] }, { error: 'HTTP 500', vehicles: [], trips: [], alerts: [] }, { timestamp: 9, vehicles: [], trips: [2], alerts: [3] }]);
  assert.deepEqual([m.vehicles, m.trips, m.alerts], [[1], [2], [3]]);
  assert.equal(m.timestamp, 9);
  assert.equal(m.error, 'HTTP 500');
});

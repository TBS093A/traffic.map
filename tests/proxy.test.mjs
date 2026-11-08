// Serwer z proxy.mjs: pliki tylko z katalogu strony, nagłówki bezpieczeństwa, dekoder protobuf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { staticPath, SECURITY_HEADERS, feedToJson } from '../proxy.mjs';

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

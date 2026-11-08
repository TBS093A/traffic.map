#!/usr/bin/env node
// Proxy GTFS-Realtime -> JSON dla "Rzeszów w pikselach". Bez zależności (Node 18+).
//
//   FEED_URL="<adres Vehicle Positions .pb z kmrzeszow.live/otwartedane>" node proxy.mjs
//
// Potem otwórz http://localhost:8787/ — strona ładuje się z tego samego serwera,
// a w Ustawieniach wpisz adres: http://localhost:8787/vehicles.json
//
// Zmienne: FEED_URL (wymagana), PORT (8787), POLL_MS (10000), PAGE (dist/index.html — wynik pipeline.py)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FEED_URL = process.env.FEED_URL;
const PORT = +(process.env.PORT || 8787);
const POLL_MS = +(process.env.POLL_MS || 10000);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.resolve(HERE, process.env.PAGE || 'dist/index.html');

// ---------- minimalny dekoder protobuf ----------
function reader(buf) {
  let pos = 0;
  const varint = () => {
    let res = 0, shift = 0, b;
    do { b = buf[pos++]; res += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
    return res;
  };
  return {
    get done() { return pos >= buf.length; },
    tag() { const t = varint(); return [Math.floor(t / 8), t & 7]; },
    varint,
    bytes() { const n = varint(); const s = buf.subarray(pos, pos + n); pos += n; return s; },
    float() { const v = buf.readFloatLE(pos); pos += 4; return v; },
    double() { const v = buf.readDoubleLE(pos); pos += 8; return v; },
    skip(wt) {
      if (wt === 0) varint(); else if (wt === 1) pos += 8; else if (wt === 2) { const n = varint(); pos += n; } else if (wt === 5) pos += 4;
      else throw new Error('nieobsługiwany wire type ' + wt);
    },
  };
}
function decode(buf, fields) { // fields: {nr: [nazwa, typ, powtarzalne?]}
  const r = reader(buf), out = {};
  while (!r.done) {
    const [no, wt] = r.tag(), f = fields[no];
    if (!f) { r.skip(wt); continue; }
    const [name, type, rep] = f;
    let v;
    if (type === 'string') v = r.bytes().toString('utf8');
    else if (type === 'float') v = r.float();
    else if (type === 'double') v = r.double();
    else if (type === 'varint') v = r.varint();
    else v = decode(r.bytes(), type);
    if (rep) (out[name] ||= []).push(v); else out[name] = v;
  }
  return out;
}
const TripDescriptor = { 1: ['tripId', 'string'], 2: ['startTime', 'string'], 3: ['startDate', 'string'], 5: ['routeId', 'string'], 6: ['directionId', 'varint'] };
const VehicleDescriptor = { 1: ['id', 'string'], 2: ['label', 'string'], 3: ['licensePlate', 'string'] };
const Position = { 1: ['latitude', 'float'], 2: ['longitude', 'float'], 3: ['bearing', 'float'], 4: ['odometer', 'double'], 5: ['speed', 'float'] };
const VehiclePosition = { 1: ['trip', TripDescriptor], 2: ['position', Position], 3: ['currentStopSequence', 'varint'], 4: ['currentStatus', 'varint'], 5: ['timestamp', 'varint'], 7: ['stopId', 'string'], 8: ['vehicle', VehicleDescriptor] };
const FeedEntity = { 1: ['id', 'string'], 4: ['vehicle', VehiclePosition] };
const FeedHeader = { 1: ['version', 'string'], 3: ['timestamp', 'varint'] };
const FeedMessage = { 1: ['header', FeedHeader], 2: ['entity', FeedEntity, true] };

export function feedToJson(buf) {
  const msg = decode(Buffer.from(buf), FeedMessage);
  const vehicles = [];
  for (const e of msg.entity || []) {
    const v = e.vehicle; if (!v || !v.position) continue;
    vehicles.push({
      tripId: v.trip?.tripId ?? null, routeId: v.trip?.routeId ?? null,
      lat: v.position.latitude, lon: v.position.longitude, bearing: v.position.bearing ?? null, speed: v.position.speed ?? null,
      timestamp: v.timestamp ?? msg.header?.timestamp ?? null,
      label: v.vehicle?.label ?? v.vehicle?.id ?? e.id,
    });
  }
  return { timestamp: msg.header?.timestamp ?? null, vehicles };
}

// ---------- pobieranie kanału ----------
let latest = { timestamp: null, vehicles: [], error: 'jeszcze nie pobrano' };
async function poll() {
  try {
    const r = await fetch(FEED_URL, { headers: { 'User-Agent': 'rzeszow-w-pikselach-proxy' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    latest = feedToJson(new Uint8Array(await r.arrayBuffer()));
    console.log(new Date().toLocaleTimeString('pl-PL'), 'pojazdów:', latest.vehicles.length);
  } catch (e) { latest = { ...latest, error: String(e.message || e) }; console.error('błąd pobierania:', e.message); }
}

// ---------- serwer ----------
// Strona i pliki obok niej (manifest, service worker, ikony) z katalogu PAGE; nic spoza niego.
const DIST = path.dirname(PAGE);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
    "worker-src 'self'", "manifest-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
  ].join('; '),
};
// ścieżka z adresu -> plik w DIST albo null (bez wychodzenia poza katalog, bez plików ukrytych)
export function staticPath(url, dist = DIST) {
  let p; try { p = decodeURIComponent(new URL(url, 'http://x').pathname); } catch { return null; }
  if (p === '/') p = '/index.html';
  if (p.split('/').some(s => s.startsWith('.')) || !TYPES[path.extname(p)]) return null;
  const f = path.resolve(dist, '.' + p);
  return f.startsWith(path.resolve(dist) + path.sep) ? f : null;
}
export function handler(state = () => latest) {
  return async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET, HEAD' }); return res.end(); }
    const url = req.url || '/';
    if (url.startsWith('/vehicles.json')) {
      res.writeHead(200, { ...SECURITY_HEADERS, ...cors, 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(state()));
    }
    const f = staticPath(url);
    if (f) {
      try {
        const body = await readFile(f), ext = path.extname(f);
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[ext], 'Cache-Control': ext === '.html' || f.endsWith('sw.js') ? 'no-cache' : 'max-age=3600' });
        return res.end(req.method === 'HEAD' ? undefined : body);
      } catch { /* brak pliku: 404 niżej */ }
    }
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Nie ma takiej strony');
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (FEED_URL) { poll(); setInterval(poll, POLL_MS); }
  else { latest = { timestamp: null, vehicles: [], error: 'proxy działa bez FEED_URL: tylko rozkład' }; console.log('Bez FEED_URL: serwuję samą stronę, bez pozycji na żywo.'); }
  http.createServer(handler()).listen(PORT, () => console.log(`Serwer: http://localhost:${PORT}/  (JSON: /vehicles.json)`));
}

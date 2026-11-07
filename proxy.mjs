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

// ---------- serwer ----------
let latest = { timestamp: null, vehicles: [], error: 'jeszcze nie pobrano' };
async function poll() {
  try {
    const r = await fetch(FEED_URL, { headers: { 'User-Agent': 'rzeszow-w-pikselach-proxy' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    latest = feedToJson(new Uint8Array(await r.arrayBuffer()));
    console.log(new Date().toLocaleTimeString('pl-PL'), 'pojazdów:', latest.vehicles.length);
  } catch (e) { latest = { ...latest, error: String(e.message || e) }; console.error('błąd pobierania:', e.message); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!FEED_URL) { console.error('Ustaw FEED_URL (adres kanału Vehicle Positions .pb).'); process.exit(1); }
  poll(); setInterval(poll, POLL_MS);
  http.createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    if (req.url.startsWith('/vehicles.json')) {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(latest));
    }
    if (req.url === '/' || req.url.startsWith('/index.html')) {
      try { const html = await readFile(PAGE); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); }
      catch { res.writeHead(404); return res.end('Brak pliku ' + PAGE); }
    }
    res.writeHead(404, cors); res.end();
  }).listen(PORT, () => console.log(`Proxy: http://localhost:${PORT}/  (JSON: /vehicles.json)`));
}

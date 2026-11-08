#!/usr/bin/env node
// Proxy GTFS-Realtime -> JSON dla "Rzeszów w pikselach". Bez zależności (Node 18+).
//
//   FEED_URL="<adres Vehicle Positions .pb z kmrzeszow.live/otwartedane>" node proxy.mjs
//
// Potem otwórz http://localhost:8787/ — strona ładuje się z tego samego serwera i sama włącza tryb na żywo.
//
// Zmienne: FEED_URL (pozycje pojazdów), TRIP_UPDATES_URL (prognozy odjazdów), ALERTS_URL (komunikaty
// o utrudnieniach) — każda opcjonalna; jeden kanał może zawierać kilka rodzajów danych naraz.
// PORT (8787), POLL_MS (10000), PAGE (dist/index.html — wynik pipeline.py).
// Wyjście: /vehicles.json, /trips.json, /alerts.json

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FEED_URL = process.env.FEED_URL;
const FEEDS = [...new Set([FEED_URL, process.env.TRIP_UPDATES_URL, process.env.ALERTS_URL].filter(Boolean))];
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
  // int32/int64 ze znakiem: ujemne zajmują 10 bajtów (uzupełnienie do dwóch), więc liczymy na BigInt
  const svarint = () => {
    let res = 0n, shift = 0n, b;
    do { b = buf[pos++]; res |= BigInt(b & 0x7f) << shift; shift += 7n; } while (b & 0x80);
    return Number(BigInt.asIntN(64, res));
  };
  return {
    get done() { return pos >= buf.length; },
    tag() { const t = varint(); return [Math.floor(t / 8), t & 7]; },
    varint, svarint,
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
    else if (type === 'int') v = r.svarint();
    else v = decode(r.bytes(), type);
    if (rep) (out[name] ||= []).push(v); else out[name] = v;
  }
  return out;
}
const TripDescriptor = { 1: ['tripId', 'string'], 2: ['startTime', 'string'], 3: ['startDate', 'string'], 4: ['scheduleRelationship', 'varint'], 5: ['routeId', 'string'], 6: ['directionId', 'varint'] };
const VehicleDescriptor = { 1: ['id', 'string'], 2: ['label', 'string'], 3: ['licensePlate', 'string'] };
const Position = { 1: ['latitude', 'float'], 2: ['longitude', 'float'], 3: ['bearing', 'float'], 4: ['odometer', 'double'], 5: ['speed', 'float'] };
const VehiclePosition = { 1: ['trip', TripDescriptor], 2: ['position', Position], 3: ['currentStopSequence', 'varint'], 4: ['currentStatus', 'varint'], 5: ['timestamp', 'varint'], 7: ['stopId', 'string'], 8: ['vehicle', VehicleDescriptor] };
const StopTimeEvent = { 1: ['delay', 'int'], 2: ['time', 'int'], 3: ['uncertainty', 'int'] };
const StopTimeUpdate = { 1: ['stopSequence', 'varint'], 2: ['arrival', StopTimeEvent], 3: ['departure', StopTimeEvent], 4: ['stopId', 'string'], 5: ['relationship', 'varint'] };
const TripUpdate = { 1: ['trip', TripDescriptor], 2: ['stopTimeUpdate', StopTimeUpdate, true], 3: ['vehicle', VehicleDescriptor], 4: ['timestamp', 'varint'], 5: ['delay', 'int'] };
const Translation = { 1: ['text', 'string'], 2: ['language', 'string'] };
const TranslatedString = { 1: ['translation', Translation, true] };
const TimeRange = { 1: ['start', 'varint'], 2: ['end', 'varint'] };
const EntitySelector = { 1: ['agencyId', 'string'], 2: ['routeId', 'string'], 3: ['routeType', 'varint'], 4: ['trip', TripDescriptor], 5: ['stopId', 'string'] };
const Alert = { 1: ['activePeriod', TimeRange, true], 5: ['informedEntity', EntitySelector, true], 6: ['cause', 'varint'], 7: ['effect', 'varint'],
  8: ['url', TranslatedString], 10: ['headerText', TranslatedString], 11: ['descriptionText', TranslatedString] };
const FeedEntity = { 1: ['id', 'string'], 2: ['isDeleted', 'varint'], 3: ['tripUpdate', TripUpdate], 4: ['vehicle', VehiclePosition], 5: ['alert', Alert] };
const FeedHeader = { 1: ['version', 'string'], 3: ['timestamp', 'varint'] };
const FeedMessage = { 1: ['header', FeedHeader], 2: ['entity', FeedEntity, true] };

const EFFECTS = { 1: 'brak kursów', 2: 'ograniczone kursy', 3: 'duże opóźnienia', 4: 'objazd', 5: 'dodatkowe kursy', 6: 'zmiana rozkładu', 7: 'zmiana trasy', 8: 'inne', 9: 'nieznane', 10: 'przystanek przeniesiony', 11: 'bez wpływu', 12: 'utrudnienia w dostępności' };
const text = ts => { const t = ts?.translation || []; return (t.find(x => x.language === 'pl') || t.find(x => !x.language) || t[0])?.text ?? ''; };

// jedna wiadomość GTFS-Realtime -> pojazdy, prognozy kursów i komunikaty
export function feedToJson(buf) {
  const msg = decode(Buffer.from(buf), FeedMessage), ts = msg.header?.timestamp ?? null;
  const vehicles = [], trips = [], alerts = [];
  for (const e of msg.entity || []) {
    if (e.isDeleted) continue;
    const v = e.vehicle;
    if (v && v.position) vehicles.push({
      tripId: v.trip?.tripId ?? null, routeId: v.trip?.routeId ?? null,
      lat: v.position.latitude, lon: v.position.longitude, bearing: v.position.bearing ?? null, speed: v.position.speed ?? null,
      timestamp: v.timestamp ?? ts, label: v.vehicle?.label ?? v.vehicle?.id ?? e.id,
    });
    const tu = e.tripUpdate;
    if (tu && tu.trip?.tripId) trips.push({
      tripId: tu.trip.tripId, delay: tu.delay ?? null, timestamp: tu.timestamp ?? ts,
      canceled: tu.trip.scheduleRelationship === 3,
      stops: (tu.stopTimeUpdate || []).filter(u => u.relationship !== 1).map(u => ({
        seq: u.stopSequence ?? null, stopId: u.stopId ?? null,
        arrDelay: u.arrival?.delay ?? null, arrTime: u.arrival?.time ?? null, depDelay: u.departure?.delay ?? null, depTime: u.departure?.time ?? null })),
    });
    const a = e.alert;
    if (a) alerts.push({
      id: e.id, header: text(a.headerText), description: text(a.descriptionText), url: text(a.url),
      effect: EFFECTS[a.effect] || null,
      periods: (a.activePeriod || []).map(p => [p.start ?? null, p.end ?? null]),
      routes: [...new Set((a.informedEntity || []).map(s => s.routeId || s.trip?.routeId).filter(Boolean))],
      stops: [...new Set((a.informedEntity || []).map(s => s.stopId).filter(Boolean))],
      trips: [...new Set((a.informedEntity || []).map(s => s.trip?.tripId).filter(Boolean))],
    });
  }
  return { timestamp: ts, vehicles, trips, alerts };
}

// ---------- pobieranie kanałów ----------
const empty = error => ({ timestamp: null, vehicles: [], trips: [], alerts: [], error });
let latest = empty('jeszcze nie pobrano');
export function merge(parts) {
  const ok = parts.filter(p => !p.error), out = empty(parts.find(p => p.error)?.error);
  if (!out.error) delete out.error;
  for (const p of ok) { out.vehicles.push(...p.vehicles); out.trips.push(...p.trips); out.alerts.push(...p.alerts); out.timestamp = Math.max(out.timestamp ?? 0, p.timestamp ?? 0) || null; }
  return out;
}
async function poll() {
  const parts = await Promise.all(FEEDS.map(async url => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'rzeszow-w-pikselach-proxy' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return feedToJson(new Uint8Array(await r.arrayBuffer()));
    } catch (e) { console.error('błąd pobierania', url, e.message); return empty(String(e.message || e)); }
  }));
  latest = merge(parts);
  console.log(new Date().toLocaleTimeString('pl-PL'), `pojazdów: ${latest.vehicles.length}, prognoz: ${latest.trips.length}, komunikatów: ${latest.alerts.length}`);
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
    const api = /^\/(vehicles|trips|alerts)\.json(\?|$)/.exec(url);
    if (api) {
      const s = state(), body = { timestamp: s.timestamp, [api[1]]: s[api[1]] || [] };
      if (s.error) body.error = s.error;
      res.writeHead(200, { ...SECURITY_HEADERS, ...cors, 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(body));
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
  if (FEEDS.length) { poll(); setInterval(poll, POLL_MS); }
  else { latest = empty('proxy działa bez kanałów GTFS-Realtime: tylko rozkład'); console.log('Bez FEED_URL: serwuję samą stronę, bez danych na żywo.'); }
  http.createServer(handler()).listen(PORT, () => console.log(`Serwer: http://localhost:${PORT}/  (JSON: /vehicles.json)`));
}

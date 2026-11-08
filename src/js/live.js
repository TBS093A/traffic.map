/* ---- pozycje na żywo (przez lokalne proxy) ---- */
function setLiveStatus(s) { live.status = s; $('#liveStatus').textContent = s; }
async function pollLive() {
  if (!live.url) return;
  try {
    const r = await fetch(live.url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); const map = new Map(), extra = [];
    const w = warsaw(simMs());
    for (const v of j.vehicles || []) {
      const x = (v.lon - D.origin[1]) * D.kx, y = (v.lat - D.origin[0]) * D.ky;
      const ti = v.tripId != null ? S.tripById.get(String(v.tripId)) : undefined;
      if (ti === undefined) { extra.push({ x, y, a: v.bearing != null ? (90 - v.bearing) * Math.PI / 180 : 0, label: v.label }); continue; }
      const tr = S.trips[ti], pr = projectOnShape(S.shapes[tr.shape], x, y);
      if (pr.err > 150) { extra.push({ x, y, a: 0, label: v.label }); continue; }
      let tt = w.sec; if (tr.end > 86400 && tt < tr.start - 43200) tt += 86400;
      const stale = v.timestamp ? Math.max(0, Date.now() / 1000 - v.timestamp) : 0;
      const delay = clamp((tt - stale) - tripTimeAt(tr, pr.d), -900, 3600);
      const prev = live.map.get(tr.id);
      map.set(tr.id, { delay: prev ? lerp(prev.delay, delay, .6) : delay, label: v.label });
    }
    live.map = map; live.extra = extra; live.last = Date.now();
    await pollExtras();
    setLiveStatus(`Na żywo: ${map.size} kursów dopasowanych, ${extra.length} niedopasowanych` + (live.tu.size ? `, ${live.tu.size} prognoz` : '') + (live.alerts.length ? `, ${live.alerts.length} komunikatów` : '') + ` · ${new Date().toLocaleTimeString('pl-PL')}`);
  } catch (err) { setLiveStatus('Brak połączenia z proxy (' + err.message + '). Działa tryb rozkładowy.'); }
}

/* ---- prognozy odjazdów (TripUpdates) i komunikaty (Alerts) z tego samego proxy ---- */
let stopIdIndex = null;
const stopIdx = id => { if (!stopIdIndex) stopIdIndex = new Map((D.stop_ids || []).map((s, i) => [s, i])); return stopIdIndex.get(id); };
async function getJson(url) { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
async function pollExtras() {
  if (!/vehicles\.json/.test(live.url)) return;
  const [tj, aj] = await Promise.all([getJson(live.url.replace(/vehicles\.json/, 'trips.json')), getJson(live.url.replace(/vehicles\.json/, 'alerts.json'))]);
  if (tj && Array.isArray(tj.trips)) live.tu = tripUpdatesFrom(tj.trips);
  if (aj && Array.isArray(aj.alerts)) live.alerts = alertsFrom(aj.alerts);
}
// tripId -> { delay, canceled, at: [[k, opóźnienie]] } — k to numer przystanku w kursie
function tripUpdatesFrom(list) {
  const out = new Map();
  for (const u of list) {
    const ti = S.tripById.get(String(u.tripId)); if (ti === undefined) continue;
    const tr = S.trips[ti], at = [];
    for (const s of u.stops || []) {
      let k = -1;
      const si = s.stopId != null ? stopIdx(s.stopId) : undefined;
      if (si !== undefined) k = tr.stops.indexOf(si);
      if (k < 0 && s.seq != null && s.seq >= 1 && s.seq <= tr.stops.length) k = s.seq - 1;   // stop_sequence zwykle liczone od 1
      if (k < 0) continue;
      let d = s.depDelay ?? s.arrDelay;
      if (d == null && (s.depTime || s.arrTime)) d = (s.depTime || s.arrTime) - absTime(tr, k);
      if (d != null) at.push([k, clamp(d, -900, 3600)]);
    }
    at.sort((a, b) => a[0] - b[0]);
    out.set(tr.id, { delay: u.delay ?? (at.length ? at[at.length - 1][1] : null), canceled: !!u.canceled, at });
  }
  return out;
}
// rozkładowy czas odjazdu z przystanku k jako znacznik Unix (dziś, strefa Warszawy)
function absTime(tr, k) {
  const ms = simMs(), w = warsaw(ms);
  return Math.round(ms / 1000 - w.sec + tr.times[2 * k + 1]);
}
const liveFresh = () => Date.now() - live.last < 90000;
// opóźnienie kursu na przystanku k [s] albo null, gdy nie ma danych na żywo
function liveDelay(tr, k) {
  if (!liveFresh()) return null;
  const tu = live.tu.get(tr.id);
  if (tu) {
    let d = null; for (const [kk, dd] of tu.at) { if (kk > k) break; d = dd; }   // opóźnienie płynie dalej wzdłuż kursu
    if (d === null) d = tu.at.length ? tu.at[0][1] : tu.delay;
    if (d !== null) return d;
  }
  const lv = live.map.get(tr.id);
  return lv ? lv.delay : null;
}
const isCanceled = tr => liveFresh() && !!live.tu.get(tr.id)?.canceled;
function startLive() { clearInterval(live.timer); live.map = new Map(); live.extra = []; live.tu = new Map(); live.alerts = []; if (!live.url) { setLiveStatus('Tryb rozkładowy: autobusy jeżdżą według rozkładu.'); return; } pollLive(); live.timer = setInterval(pollLive, 10000); }
$('#liveUrl').value = live.url;
$('#liveGo').onclick = () => { live.url = $('#liveUrl').value.trim(); store.set('liveUrl', live.url); startLive(); };
// Strona podana przez proxy.mjs ma obok siebie vehicles.json: wtedy tryb na żywo włącza się sam,
// bez wpisywania adresu w ustawieniach. Adres wpisany ręcznie ma pierwszeństwo.
async function autoLive() {
  if (live.url || !/^https?:$/.test(location.protocol)) { startLive(); return; }
  const url = new URL('vehicles.json', location.href).href;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    const j = r.ok && /json/.test(r.headers.get('content-type') || '') ? await r.json() : null;
    if (j && Array.isArray(j.vehicles) && (j.vehicles.length || !j.error)) { live.url = url; $('#liveUrl').placeholder = url + ' (wykryto automatycznie)'; }
  } catch (e) { /* brak proxy: zostaje rozkład */ }
  startLive();
}


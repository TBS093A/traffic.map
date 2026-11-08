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
    setLiveStatus(`Na żywo: ${map.size} kursów dopasowanych, ${extra.length} niedopasowanych · ${new Date().toLocaleTimeString('pl-PL')}`);
  } catch (err) { setLiveStatus('Brak połączenia z proxy (' + err.message + '). Działa tryb rozkładowy.'); }
}
function startLive() { clearInterval(live.timer); live.map = new Map(); live.extra = []; if (!live.url) { setLiveStatus('Tryb rozkładowy: autobusy jeżdżą według rozkładu.'); return; } pollLive(); live.timer = setInterval(pollLive, 10000); }
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


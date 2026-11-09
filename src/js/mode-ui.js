/* ======================= INTERFEJS TRYBÓW: pociągi, samoloty, lotnisko, infrastruktura ======================= */
// Listy dla trybów innych niż autobusy. Wiersze prowadzą do tych samych arkuszy co kliknięcie na mapie.
const distKm = (x, y) => (Math.hypot(x, y) / 1000).toFixed(1).replace('.', ',');
const flyTo = (x, y, half) => { cam.x = x; cam.z = -y; if (half) cam.half = Math.min(cam.half, half); follow = false; followAir = false; };

// ---- pociągi: składy teraz w obszarze mapy i najczęściej obsługiwane stacje
function renderTrains() {
  const w = simState.w, rows = buses.filter(b => b.ti >= 0 && routeIsRail(S.trips[b.ti].route)).map(b => {
    const tr = S.trips[b.ti], k = Math.min(b.k, tr.stops.length - 1), next = D.stops[tr.stops[k]][2], t = tr.times[2 * k] + (b.delay || 0);
    return { b, tr, next, t };
  }).sort((a, b) => a.t - b.t);
  const list = rows.map(({ b, tr, next, t }) => `<li data-trip="${b.ti}">${chip(tr.route)}<span class="grow"><b>${esc(tr.brig || '')}</b> → ${esc(tr.head)}<br><span class="mut">${b.at ? 'na stacji' : 'dalej'}: ${esc(next)} ${fmtT(t)}</span></span></li>`).join('');
  const stations = S.groups.filter(g => g.rail && g.trips > 0).sort((a, b) => b.trips - a.trips).slice(0, 8);
  $('#trainList').innerHTML = `<p class="note">Teraz w obszarze mapy: ${rows.length} ${rows.length === 1 ? 'pociąg' : rows.length % 10 >= 2 && rows.length % 10 <= 4 && (rows.length % 100 < 10 || rows.length % 100 >= 20) ? 'pociągi' : 'pociągów'} (${fmtT(w.sec)}).</p>
    <ul class="list">${list || '<li class="past">Żaden pociąg nie jedzie teraz przez okolicę Rzeszowa.</li>'}</ul>
    <h4>Odjazdy ze stacji</h4><ul class="list">${stations.map(g => groupRowsHtml(g).split('</li>')[0] + '</li>').join('')}</ul>`;
}
const openTrains = () => { renderTrains(); openOv('trainsOv'); };
$('#trainList').addEventListener('click', e => {
  if (listClick(e, 'trainsOv')) return;
  const t = e.target.closest('[data-trip]'); if (!t) return;
  const ti = +t.dataset.trip; select({ trip: ti }); follow = true; $('#trainsOv').classList.remove('show');
});

// ---- samoloty: lista po odległości od Rynku
function airStatus() {
  if (!AIR.url) return 'Samoloty są widoczne tylko na stronie otwartej z serwera <code>proxy.mjs</code> (dane ADS-B z adsb.lol).';
  if (!AIR.ok) return esc(AIR.error || 'Łączenie z serwerem…');
  if (Math.abs(simMs() - Date.now()) > 120000) return 'Zegar symulacji jest przesunięty: samoloty pokazują się tylko w czasie rzeczywistym (przycisk „Teraz”).';
  return '';
}
function planeRow(p) {
  const a = p.a, alt = a.gnd ? 'na ziemi' : `${(a.alt ?? 0).toLocaleString('pl-PL')} m`;
  return `<li data-air="${esc(a.hex)}"><span class="grow"><b>✈ ${esc(a.flight || a.reg || a.hex.toUpperCase())}</b> ${esc(a.type || '')}<br><span class="mut">${alt} · ${a.gs ?? '?'} km/h · ${distKm(p.x, p.y)} km od Rynku</span></span></li>`;
}
function renderPlanes() {
  const ps = [...planes].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)), st = airStatus();
  $('#planeList').innerHTML = (st ? `<p class="note">${st}</p>` : `<p class="note">${ps.length} w promieniu ok. 75 km, odświeżane co 8 s.</p>`)
    + `<ul class="list">${ps.map(planeRow).join('') || (st ? '' : '<li class="past">Teraz nic nie leci w zasięgu.</li>')}</ul>`;
}
const openPlanes = () => { renderPlanes(); openOv('planesOv'); };

// ---- lotnisko: ruch przy Jasionce i dojazd (pociąg, autobus)
function airportXY() {
  if (INFRA && INFRA.air.rw.length) { const p = undelta(INFRA.air.rw[0][1]), n = p.length; return [(p[0] + p[n - 2]) / 2, (p[1] + p[n - 1]) / 2]; }
  return [(22.019 - D.origin[1]) * D.kx, (50.11 - D.origin[0]) * D.ky];
}
function renderAirport() {
  const [ax, ay] = airportXY(), near = p => Math.hypot(p.x - ax, p.y - ay) / 1000;
  const ground = planes.filter(p => (p.a.gnd || (p.a.alt ?? 1e9) < 150) && near(p) < 4);
  const low = planes.filter(p => !ground.includes(p) && (p.a.alt ?? 1e9) < 3000 && near(p) < 30);
  const arr = low.filter(p => (p.a.vr || 0) < -.5), dep = low.filter(p => (p.a.vr || 0) > .5);
  const sec = (title, list, empty) => `<h4>${title} <span>${list.length}</span></h4><ul class="list">${list.map(planeRow).join('') || `<li class="past">${empty}</li>`}</ul>`;
  const train = S.groups.find(g => g.rail && /lotnisko/i.test(g.name)), bus = S.groups.filter(g => !g.rail && /port lotniczy|lotnisko|jasionka/i.test(g.name)).sort((a, b) => b.trips - a.trips)[0];
  const st = airStatus();
  $('#airportBody').innerHTML = `<div class="btnrow"><button data-act="airportfly">📍 Pokaż lotnisko</button></div>${st ? `<p class="note">${st}</p>` : ''}
    ${sec('Podchodzą do lądowania', arr, 'Brak samolotów w podejściu.')}${sec('Po starcie', dep, 'Brak samolotów po starcie.')}${sec('Na płycie i pasie', ground, 'Nic nie stoi na lotnisku (albo transpondery są wyłączone).')}
    <h4>Dojazd</h4><ul class="list">${train ? groupRowsHtml(train).split('</li>')[0] + '</li>' : ''}${bus ? groupRowsHtml(bus).split('</li>')[0] + '</li>' : ''}</ul>
    <p class="note">Ruch z ADS-B (adsb.lol): podejście i start to samoloty poniżej 3000 m w promieniu 30 km, które się zniżają albo wznoszą.</p>`;
}
const openAirport = () => { renderAirport(); openOv('airportOv'); };
for (const id of ['planeList', 'airportBody']) $('#' + id).addEventListener('click', e => {
  const ov = e.target.closest('.overlay');
  if (e.target.closest('[data-act="airportfly"]')) { const [x, y] = airportXY(); flyTo(x, y, 1600); ov.classList.remove('show'); return; }
  if (listClick(e, ov.id)) return;
  const a = e.target.closest('[data-air]'); if (!a) return;
  const p = planes.find(p => p.a.hex === a.dataset.air);
  selectAir(a.dataset.air); if (p) { flyTo(p.x, p.y); followAir = true; }
  ov.classList.remove('show');
});

// ---- infrastruktura: zakładki kategorii, lista po odległości od środka widoku
const INFRA_TABS = [['bts', '📶 Stacje bazowe'], ['fuel', '⛽ Paliwo'], ['ev', '🔌 Ładowarki'], ['mast', '📡 Maszty'], ['power', '⚡ Energetyka']];
let infraTab = store.get('infraTab', 'bts'), infraOp = '';
function powerStats() {
  let hv = 0, lv = 0, nhv = 0, nlv = 0;
  for (const [, minor, enc] of INFRA ? INFRA.pw.l : []) {
    const p = undelta(enc); let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    if (minor) { lv += L; nlv += p.length / 2; } else { hv += L; nhv += p.length / 2; }
  }
  return { hv, lv, nhv, nlv, ss: INFRA ? INFRA.pw.ss.length : 0 };
}
function renderInfraList() {
  $('#infraTabs').innerHTML = INFRA_TABS.map(([k, t]) => `<button data-it="${k}" class="${k === infraTab ? 'on' : ''}">${t}</button>`).join('');
  const cx = cam.x, cy = -cam.z, km = P => (Math.hypot(P.x - cx, P.y - cy) / 1000).toFixed(1).replace('.', ',') + ' km';
  if (infraTab === 'power') {
    const s = powerStats(), f = v => Math.round(v / 1000).toLocaleString('pl-PL');
    $('#infraList').innerHTML = `<ul class="list"><li><span class="grow">Linie wysokiego napięcia</span><span class="mut">${f(s.hv)} km · ${s.nhv.toLocaleString('pl-PL')} słupów</span></li>
      <li><span class="grow">Linie średniego i niskiego napięcia</span><span class="mut">${f(s.lv)} km · ${s.nlv.toLocaleString('pl-PL')} słupów</span></li>
      <li><span class="grow">Stacje transformatorowe i rozdzielnie</span><span class="mut">${s.ss}</span></li></ul>
      <p class="note">Z OpenStreetMap: tylko to, co ktoś zmapował. Linie kablowe pod ziemią nie są rysowane.</p>`;
    return;
  }
  let items = infraPts.map((P, i) => ({ P, i })).filter(({ P }) => P.type === infraTab);
  let filt = '';
  if (infraTab === 'bts') {
    const ops = [...new Set(items.flatMap(({ P }) => P.tx.map(t => t[0])))].sort();
    filt = `<div class="fbar">${['', ...ops].map(o => `<button data-op="${esc(o)}" class="${o === infraOp ? 'on' : ''}">${o ? esc(o) : 'Wszyscy'}</button>`).join('')}</div>`;
    if (infraOp) items = items.filter(({ P }) => P.tx.some(t => t[0] === infraOp));
  }
  items.sort((a, b) => Math.hypot(a.P.x - cx, a.P.y - cy) - Math.hypot(b.P.x - cx, b.P.y - cy));
  const row = ({ P, i }) => {
    const title = P.type === 'bts' ? P.name || 'Stacja bazowa' : P.type === 'mast' ? P.name || MAST_KIND[P.kind] : P.name || (P.type === 'ev' ? 'Ładowarka' : 'Stacja paliw');
    const sub = P.type === 'bts' ? P.tx.map(([op, t]) => `${op} ${[...new Set(t.split(' ').map(GEN))].sort().join('/')}`).join(' · ') : P.type === 'mast' ? `${MAST_KIND[P.kind]} · ${P.h} m` : P.info || '';
    return `<li data-inf="${i}"><span class="grow">${esc(title)}${sub ? `<br><span class="mut">${esc(sub)}</span>` : ''}</span><span class="mut">${km(P)}</span></li>`;
  };
  $('#infraList').innerHTML = filt + `<p class="note">${items.length} · najbliżej środka widoku na górze</p><ul class="list">${items.slice(0, 200).map(row).join('') || '<li class="past">Brak danych w tej kategorii.</li>'}</ul>`;
}
const openInfraList = () => { renderInfraList(); openOv('infraOv'); };
$('#infraOv').addEventListener('click', e => {
  const t = e.target.closest('[data-it]'); if (t) { infraTab = t.dataset.it; store.set('infraTab', infraTab); renderInfraList(); return; }
  const o = e.target.closest('[data-op]'); if (o) { infraOp = o.dataset.op; renderInfraList(); return; }
  const r = e.target.closest('[data-inf]'); if (!r) return;
  const i = +r.dataset.inf, P = infraPts[i]; selectInfra(i); flyTo(P.x, P.y, 500); $('#infraOv').classList.remove('show');
});

// ---- przyciski i skróty zależne od trybu
$('#bTrains').onclick = openTrains;
$('#bStations').onclick = () => { openOv('stopsOv'); renderStopList($('#sq').value); };
$('#bPlanes').onclick = openPlanes;
$('#bAirport').onclick = openAirport;
$('#bInfra').onclick = openInfraList;
const MODE_LIST = { bus: () => openLines(), rail: openTrains, air: openPlanes, infra: openInfraList };
function openModeList() { MODE_LIST[uiMode](); }
// listy otwarte na bieżąco: pociągi i samoloty się przesuwają
setInterval(() => {
  if ($('#trainsOv').classList.contains('show')) renderTrains();
  if ($('#planesOv').classList.contains('show')) renderPlanes();
  if ($('#airportOv').classList.contains('show')) renderAirport();
}, 4000);

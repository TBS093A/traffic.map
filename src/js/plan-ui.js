/* ---- podgląd wariantu na mapie ---- */
function geoFromPolys(polys) {
  return stripLines(polys.filter(p => p.length >= 4).map(p => {
    const cum = [0]; for (let i = 2; i < p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
    return onBridges({ pts: p, cum });
  }));
}
function shapeSlice(si, d0, d1) {
  const { pts, cum } = S.shapes[si], out = [], P = {};
  pointAt(S.shapes[si], d0, P); out.push(P.x, P.y);
  for (let i = 0; i < cum.length; i++) if (cum[i] > d0 && cum[i] < d1) out.push(pts[2 * i], pts[2 * i + 1]);
  pointAt(S.shapes[si], d1, P); out.push(P.x, P.y);
  return out;
}
const legPoly = L => L.type === 'ride' ? shapeSlice(S.trips[L.ti].shape, S.trips[L.ti].dist[L.from], S.trips[L.ti].dist[L.to]) : [...L.fromXY, ...(L.via || []), ...L.toXY];
function setPlanGeo() {
  const o = plan.sel >= 0 ? plan.options[plan.sel] : null;
  const key = o ? plan.sel + ':' + o.dep + ':' + o.arr + ':' + plan.options.length : '';
  if (key === plan.key) return; plan.key = key;
  for (const g of plan.geo) { gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.buf); }
  plan.geo = []; if (!o) return;
  for (const L of o.legs) {
    const g = geoFromPolys([legPoly(L)]), v = vaoFrom(g, STRIP);
    plan.geo.push({ ...v, count: g.length / 7, mode: L.type === 'ride' ? 1 : 2, color: L.type === 'ride' ? D.routes[L.route].c : [255, 255, 255] });
  }
}
function planStops() {
  const o = plan.sel >= 0 ? plan.options[plan.sel] : null; if (!o) return [];
  const s = new Set();
  for (const L of o.legs) { if (L.type === 'ride') { s.add(L.fromStop); s.add(L.toStop); } else { if (L.from !== null) s.add(L.from); if (L.to !== null) s.add(L.to); } }
  return [...s];
}
function planMarkers() { // punkty start/cel (gdy nie są przystankami) + moja lokalizacja
  const out = [], o = plan.sel >= 0 ? plan.options[plan.sel] : null;
  if (o) {
    const f = o.legs[0], l = o.legs[o.legs.length - 1];
    if (f.type === 'walk' && f.from === null) out.push({ x: f.fromXY[0], y: f.fromXY[1], text: 'START', tint: [.45, .95, .5, 1] });
    if (l.type === 'walk' && l.to === null) out.push({ x: l.toXY[0], y: l.toXY[1], text: 'CEL', tint: [1, .45, .4, 1] });
  }
  if (plan.me) out.push({ x: plan.me.x, y: plan.me.y, text: 'TU JESTEŚ', tint: [.4, .75, 1, 1] });
  return out;
}
function fitPlan() {
  const o = plan.options[plan.sel]; if (!o) return;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const L of o.legs) { const p = legPoly(L); for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); } }
  // kadruj w górnej części ekranu, nad panelem szczegółów
  const frac = clamp(1 - Math.min(innerHeight * .46, 420) / innerHeight, .45, 1);
  const ext = Math.max(x1 - x0, y1 - y0, 300), asp = innerWidth / innerHeight;
  cam.half = clamp(Math.max(ext * .7 / asp, ext * .7 * Math.sin(cam.elev) / frac) * 1.1, 150, 7000);
  const shift = (1 - frac) * cam.half / Math.sin(cam.elev);
  cam.x = (x0 + x1) / 2 + Math.sin(cam.yawT) * shift; cam.z = -(y0 + y1) / 2 + Math.cos(cam.yawT) * shift; follow = false;
}

/* ---- UI planera ---- */
const dur = s => { const m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
function fieldInput(f) { return $(f === 'from' ? '#pFrom' : '#pTo'); }
function fieldBox(f) { return $(f === 'from' ? '#sFrom' : '#sTo'); }
function suggest(field) {
  const val = fieldInput(field).value, n = norm(val.trim()), box = fieldBox(field);
  let html = `<div data-act="gps" data-f="${field}">📍 Moja lokalizacja</div><div data-act="pick" data-f="${field}">🗺 Wskaż na mapie</div>`;
  const places = [];
  if (n.length >= 2) {
    places.push(...geocode(val).slice(0, 6));
    const p = parseAddr(val), q = p.words.join(' ');
    S.groups.filter(g => g.trips > 0 && g.n.includes(q)).sort((a, b) => (b.n.startsWith(q) - a.n.startsWith(q)) || b.trips - a.trips).slice(0, 5)
      .forEach(g => places.push({ kind: 'stop', g: g.id, label: g.name, icon: '🚏', routes: g.routeList }));
    html += places.map((p, i) => `<div data-pi="${i}" data-f="${field}"><span>${p.icon} ${esc(p.label)}${p.note ? ` <span class="mut">${esc(p.note)}</span>` : ''}</span>${p.routes ? miniChips(p.routes, 5) : ''}</div>`).join('');
    if (!places.length) html += '<div class="empty">Nic nie znaleziono</div>';
  }
  plan.sugg[field] = places; box.innerHTML = html;
}
function setPlace(field, p) {
  plan[field === 'from' ? 'fromP' : 'toP'] = p; fieldBox('from').innerHTML = fieldBox('to').innerHTML = '';
  syncPlanFields(); if (plan.fromP && plan.toP) runPlan(); else renderPlanResults();
}
function syncPlanFields() {
  $('#pFrom').value = plan.fromP ? plan.fromP.label : '';
  $('#pTo').value = plan.toP ? plan.toP.label : '';
  if (!$('#pTime').value) $('#pTime').value = fmtT(warsaw(simMs()).sec);
}
function openPlanner() { syncPlanFields(); openOv('planOv'); if (plan.fromP && plan.toP && !plan.options.length) runPlan(); else renderPlanResults(); }
function legChips(o) { return o.legs.map(L => L.type === 'ride' ? chip(L.route) : `<span class="walk">🚶${Math.max(1, Math.round(L.dur / 60))}′</span>`).join('<span class="arrow">›</span>'); }
function runPlan(later) {
  if (!plan.fromP || !plan.toP) { renderPlanResults(); return; }
  if ((plan.fromP.kind === 'stop' && plan.toP.kind === 'stop' && plan.fromP.g === plan.toP.g) || closestPair(placePts(plan.fromP), placePts(plan.toP)).d < 40) { renderPlanResults('Start i cel są w tym samym miejscu.'); return; }
  const w = warsaw(simMs()); let t0;
  if (later && plan.options.length) t0 = Math.min(...plan.options.filter(o => o.rides).map(o => o.dep).concat([plan.t + 600])) + 60;
  else { const [h, m] = ($('#pTime').value || fmtT(w.sec)).split(':').map(Number); t0 = h * 3600 + m * 60; }
  if (later) planRemember(); else plan.hist = [];
  plan.t = t0;
  const t1 = performance.now();
  // od najkrótszego czasu podróży; przy remisie wcześniejszy przyjazd, potem mniej przesiadek
  plan.options = planRoute(plan.fromP, plan.toP, w.ymd, t0).sort((a, b) => (a.arr - a.dep) - (b.arr - b.dep) || a.arr - b.arr || a.rides - b.rides);
  plan.ms = Math.round(performance.now() - t1);
  plan.sel = plan.options.length ? 0 : -1; plan.key = '#';
  if (plan.sel >= 0) { selTrip = -1; selStop = -1; selRoute = -1; setPlanGeo(); }
  renderPlanResults(); lastSheet = 0; renderSheet();
}
// historia wariantów: "Poprzedni wariant" wraca do trasy pokazanej wcześniej (także sprzed "Późniejszych odjazdów")
function planRemember() { if (plan.options.length) plan.hist.push({ t: plan.t, options: plan.options, sel: plan.sel, ms: plan.ms }); }
function planBack() {
  const h = plan.hist.pop(); if (!h) return;
  Object.assign(plan, h); plan.key = '#'; selTrip = -1; selStop = -1; selRoute = -1;
  if (plan.sel >= 0) { setPlanGeo(); fitPlan(); }
  renderPlanResults(); lastSheet = 0; renderSheet();
}
function renderPlanResults(msg) {
  const box = $('#pRes');
  if (msg) { box.innerHTML = `<p class="note">${msg}</p>`; return; }
  const addrNote = GEO.hasNums ? '' : '<p class="note">Ta wersja nie ma bazy adresów OSM, więc szukam po ulicy (bez numerów budynków). Pipeline dołącza adresy automatycznie.</p>';
  if (!plan.fromP || !plan.toP) { box.innerHTML = '<p class="note">Wpisz adres („Rejtana 16”), ulicę albo przystanek. Możesz też użyć swojej lokalizacji albo wskazać punkt na mapie.</p>' + addrNote; return; }
  if (!plan.options.length) { box.innerHTML = `<p class="note">Brak połączenia (do ${MAX_ROUNDS - 1} przesiadek) w ciągu ${HORIZON / 3600} h od ${fmtT(plan.t)}.</p><div class="btnrow"><button data-pact="later">Szukaj później</button></div>`; return; }
  const direct = plan.options.find(o => o.rides === 1), walkOnly = plan.options.find(o => o.rides === 0);
  const head = direct ? `<p class="note ok">✔ Dojedziesz bez przesiadki: linia ${chip(direct.legs.find(l => l.type === 'ride').route)}</p>`
    : walkOnly && plan.options.length === 1 ? '<p class="note ok">✔ Najszybciej pieszo</p>'
    : '<p class="note">Brak bezpośredniej linii w tym czasie, poniżej warianty z przesiadkami:</p>';
  const trText = o => o.rides === 0 ? 'pieszo' : o.transfers === 0 ? 'bez przesiadek' : o.transfers + ' ' + (o.transfers === 1 ? 'przesiadka' : 'przesiadki');
  box.innerHTML = head + '<ul class="list opts">' + plan.options.map((o, i) => `<li data-o="${i}" class="${i === plan.sel ? 'now' : ''}">
    <div class="ot"><b class="t">${fmtT(o.dep)} → ${fmtT(o.arr)}${i === 0 && plan.options.length > 1 ? '<span class="best">najkrócej</span>' : ''}</b><span class="mut">${dur(o.arr - o.dep)} · ${trText(o)}</span></div>
    <div class="ol">${legChips(o)}</div></li>`).join('') + '</ul>' +
    `<div class="btnrow">${plan.hist.length ? '<button data-pact="prev">↶ Poprzedni wariant</button>' : ''}<button data-pact="later">Późniejsze odjazdy</button></div><p class="note">Policzono w ${plan.ms} ms. Warianty od najkrótszego czasu podróży; pierwszy jest od razu na mapie.</p>` + addrNote;
}
function planSheet() {
  const o = plan.options[plan.sel], w = simState.w;
  const rows = o.legs.map(L => {
    if (L.type === 'walk') return `<li class="leg walk"><span class="t">${fmtT(L.dep)}</span><span class="grow">🚶 ${dur(L.dur)} pieszo (ok. ${Math.round(L.dur * 1.2 / 10) * 10} m) do <b>${esc(L.toName)}</b></span></li>`;
    const tr = S.trips[L.ti], n = L.to - L.from, live = buses.find(b => b.ti === L.ti), until = L.dep - w.sec;
    return `<li class="leg" data-trip="${L.ti}"><span class="t">${fmtT(L.dep)}</span>${chip(L.route)}<span class="grow"><b>${esc(D.stops[L.fromStop][2])}</b> → ${esc(tr.head)}<br><span class="mut">${n} ${n === 1 ? 'przystanek' : n < 5 ? 'przystanki' : 'przystanków'} · wysiadka ${fmtT(L.arr)} <b>${esc(D.stops[L.toStop][2])}</b>${live ? ' · 🚌 w trasie' : until > 0 ? ' · odjazd za ' + Math.ceil(until / 60) + ' min' : ''}</span></span></li>`;
  }).join('');
  return `<button class="close" data-act="planclose">✕</button>
  <h2>🧭 ${esc(plan.fromP.label)} → ${esc(plan.toP.label)}</h2>
  <div class="sub">${fmtT(o.dep)} → ${fmtT(o.arr)} · ${dur(o.arr - o.dep)} · ${o.rides === 0 ? 'pieszo' : o.transfers === 0 ? 'bez przesiadek' : o.transfers + ' ' + (o.transfers === 1 ? 'przesiadka' : 'przesiadki')}</div>
  <div class="btnrow">${plan.hist.length ? '<button data-act="planprev">↶ Poprzedni wariant</button>' : ''}<button data-act="planopts">Inne warianty</button><button data-act="planfit">Pokaż całą trasę</button>${shareBtn()}</div>
  <ul class="list">${rows}<li class="leg end"><span class="t">${fmtT(o.arr)}</span><span class="grow">🏁 <b>${esc(plan.toP.label)}</b></span></li></ul>`;
}

/* ---- lokalizacja i wskazanie na mapie ---- */
function toast(msg) { const t = $('#toast'); if (!msg) { t.style.display = 'none'; return; } t.textContent = msg; t.style.display = 'block'; }
function locate(field) {
  const fail = m => { renderPlanResults(m); };
  if (!navigator.geolocation) { fail('Ta przeglądarka nie udostępnia lokalizacji.'); return; }
  renderPlanResults('Ustalam lokalizację…');
  let done = false;
  const blocked = 'W podglądzie w Claude lokalizacja jest zablokowana. Działa po otwarciu strony z własnego serwera (localhost albo https). Możesz użyć „Wskaż na mapie”.';
  const guard = setTimeout(() => { if (!done) { done = true; fail('Lokalizacja nie odpowiada. ' + blocked); } }, 12000);
  try {
    navigator.geolocation.getCurrentPosition(pos => {
      if (done) return; done = true; clearTimeout(guard);
      const x = (pos.coords.longitude - D.origin[1]) * D.kx, y = (pos.coords.latitude - D.origin[0]) * D.ky;
      let nd = 1e18; for (const s of D.stops) nd = Math.min(nd, Math.hypot(s[0] - x, s[1] - y));
      if (nd > 5000) { fail(`Twoja lokalizacja jest poza siecią ZTM Rzeszów (najbliższy przystanek: ${(nd / 1000).toFixed(1)} km).`); return; }
      plan.me = { x, y, acc: pos.coords.accuracy };
      setPlace(field, { kind: 'point', x, y, label: 'Moja lokalizacja', icon: '📍' });
    }, err => {
      if (done) return; done = true; clearTimeout(guard);
      fail(err.code === 1 ? 'Brak zgody na lokalizację. ' + blocked : 'Nie udało się ustalić lokalizacji (' + esc(err.message || 'błąd') + ').');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  } catch (e) { done = true; clearTimeout(guard); fail('Lokalizacja jest niedostępna w tym widoku. Użyj „Wskaż na mapie”.'); }
}
let pickMode = null;
function startPick(field) { pickMode = field; $('#planOv').classList.remove('show'); toast(field === 'from' ? 'Dotknij mapy, aby wybrać START trasy' : 'Dotknij mapy, aby wybrać CEL trasy'); }
function finishPick(px, py) {
  const [gx, gz] = screenToGround(px, py), x = gx, y = -gz, field = pickMode;
  pickMode = null; toast('');
  plan[field === 'from' ? 'fromP' : 'toP'] = { kind: 'point', x, y, label: reverseGeocode(x, y), icon: '📌' };
  syncPlanFields(); openOv('planOv'); if (plan.fromP && plan.toP) runPlan(); else renderPlanResults();
}


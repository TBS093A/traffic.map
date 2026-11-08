/* ======================= UI ======================= */
let lastUI = 0, lastSheet = 0, sheetPressed = false;   // wciśnięty palec/kursor na arkuszu: odświeżanie czeka
$('#sheet').addEventListener('pointerdown', () => { sheetPressed = true; });
addEventListener('pointerup', () => { sheetPressed = false; }); addEventListener('pointercancel', () => { sheetPressed = false; });
function updateUI(now) {
  if (now - lastUI < 200) return; lastUI = now;
  const ms = simMs(), w = simState.w;
  $('#clock').textContent = fmtT(w.sec) + ':' + String(Math.floor(w.sec % 60)).padStart(2, '0');
  $('#day').textContent = dayFmt.format(new Date(ms)) + (simState.fallback ? ' · rozkład wzorcowy' : '') + (live.map.size && Date.now() - live.last < 90000 ? ' · NA ŻYWO' : '');
  if (now - lastSheet > 1000 && !sheetPressed) { lastSheet = now; renderSheet(); }
  syncLink(now); syncAlertsBtn(); checkReminders(w.sec);
}

// arkusz odświeża się co sekundę: podmieniamy treść tylko gdy się zmieniła, żeby przyciski nie znikały spod palca w trakcie kliknięcia
function sheetShow(html) { const s = $('#sheet'); if (s._html !== html) { s.innerHTML = html; s._html = html; } s.classList.add('show'); document.documentElement.style.setProperty('--sheetH', (s.offsetHeight + 10) + 'px'); }
function sheetHide() { $('#sheet').classList.remove('show'); document.documentElement.style.setProperty('--sheetH', '0px'); }
const chip = r => `<span class="chip" style="background:${rgbCss(D.routes[r].c)}">${esc(D.routes[r].n)}</span>`;

function renderSheet() {
  const sheet = $('#sheet'); const keepScroll = sheet.scrollTop;
  if (selTrip >= 0) sheetShow(tripSheet(selTrip));
  else if (selStop >= 0) sheetShow(stopSheet(selStop));
  else if (plan.sel >= 0) sheetShow(planSheet());
  else if (selRoute >= 0) sheetShow(routeSheet(selRoute));
  else { sheetHide(); return; }
  sheet.scrollTop = keepScroll;
}

function tripSheet(ti) {
  const tr = S.trips[ti], b = buses.find(b => b.ti === ti), w = simState.w;
  const r = D.routes[tr.route];
  let status;
  if (b) status = b.live ? (Math.abs(b.delay) < 60 ? 'na żywo · punktualnie' : `na żywo · ${b.delay > 0 ? 'opóźnienie' : 'przed czasem'} ${Math.round(Math.abs(b.delay) / 60)} min`) : 'według rozkładu';
  else { const st = tr.start - w.sec; status = st > 0 ? `odjazd z pętli za ${Math.ceil(st / 60)} min (${fmtT(tr.start)})` : 'kurs zakończony'; }
  const kNow = b ? b.k : (w.sec < tr.start ? 0 : tr.stops.length);
  let rows = '';
  const from = Math.max(0, kNow - 1);
  for (let k = from; k < tr.stops.length; k++) {
    const si = tr.stops[k], tm = tr.times[2 * k + 1] + (liveDelay(tr, k) ?? (b && b.live ? b.delay : 0));
    const cls = k < kNow ? 'past' : (k === kNow ? 'now' : '');
    rows += `<li class="${cls}" data-stop="${si}"><span class="t">${fmtT(tm)}</span><span class="grow">${esc(D.stops[si][2])}</span></li>`;
  }
  return `<button class="close" data-act="close">✕</button>
  <h2>${chip(tr.route)} → ${esc(tr.head)}</h2>
  <div class="sub">${esc(r.name || '')}${tr.brig ? ' · brygada ' + esc(tr.brig) : ''}<br>${isCanceled(tr) ? '<b class="warn">kurs odwołany</b>' : status}</div>
  ${alertsHtml(alertsFor({ route: tr.route, trip: tr.id }))}
  <div class="btnrow"><button data-act="follow" class="${follow ? 'on' : ''}">${follow ? 'Śledzę' : 'Śledź'}</button><button data-act="route" data-r="${tr.route}">Cała linia ${esc(r.n)}</button><button data-act="fit">Pokaż trasę</button>${shareBtn()}</div>
  <ul class="list">${rows}</ul>`;
}

function departures(si, w, horizon) {
  const grp = S.groups[S.stopGroup[si]];
  return grp.members.flatMap(m => departuresOne(m, w, horizon).map(d => ({ ...d, si: m }))).sort((a, b) => a.dep - b.dep).slice(0, 50);
}
function departuresOne(si, w, horizon) {
  const today = servicesFor(w.ymd), yest = servicesFor(ymdShift(w.ymd, -1));
  const svT = new Set(today.svs.map(s => D.services.indexOf(s))), svY = new Set(yest.svs.map(s => D.services.indexOf(s)));
  const res = [];
  for (const code of S.stopTrips[si]) {
    const ti = Math.floor(code / 256), k = code % 256, tr = S.trips[ti];
    if (k === tr.stops.length - 1) continue;
    let off; if (svT.has(tr.service)) off = 0; else if (svY.has(tr.service)) off = -86400; else continue;
    const ld = liveDelay(tr, k), delay = ld ?? 0;
    const dep = tr.times[2 * k + 1] + off + delay;
    if (dep >= w.sec - 30 && dep <= w.sec + horizon) res.push({ ti, k, dep, live: ld !== null, delay, canceled: isCanceled(tr) });
  }
  return res.sort((a, b) => a.dep - b.dep).slice(0, 40);
}
function stopSheet(si) {
  const grp = S.groups[S.stopGroup[si]], w = simState.w;
  if (selSide >= 0 && !grp.members.includes(selSide)) selSide = -1;
  const all = selSide >= 0 ? departuresOne(selSide, w, 3600).map(d => ({ ...d, si: selSide })) : departures(si, w, 3600);
  const onRoad = new Map(buses.filter(b => b.ti >= 0).map(b => [b.ti, b]));   // kursy, które teraz jadą
  const active = all.filter(d => { const b = onRoad.get(d.ti); return b && b.k <= d.k; });
  const deps = stopFilter === 'act' ? active : all;
  const multi = grp.members.length > 1;
  const rows = deps.map(d => { const tr = S.trips[d.ti], m = Math.round((d.dep - w.sec) / 60), b = onRoad.get(d.ti), left = b && b.k <= d.k ? d.k - b.k : -1;
    const go = left < 0 ? '' : `<span class="go">${left === 0 ? (b.at ? '● na przystanku' : '● dojeżdża') : `● w drodze · ${left} ${left === 1 ? 'przystanek' : left % 10 >= 2 && left % 10 <= 4 && (left % 100 < 10 || left % 100 >= 20) ? 'przystanki' : 'przystanków'} stąd`}</span>`;
    const when = d.canceled ? '<b class="warn">odwołany</b>' : (m <= 0 ? 'teraz' : 'za ' + m + ' min') + (d.live ? (Math.abs(d.delay) >= 60 ? ` <span class="${d.delay > 0 ? 'warn' : ''}">${d.delay > 0 ? '+' : '−'}${Math.round(Math.abs(d.delay) / 60)}′</span>` : '') + ' ●' : '');
    return `<li data-trip="${d.ti}" class="${left >= 0 ? 'act' : ''}${d.canceled ? ' past' : ''}"><span class="t">${fmtT(d.dep)}</span>${chip(tr.route)}<span class="grow">${esc(tr.head)}${go ? '<br>' + go : ''}</span>${multi && selSide < 0 ? `<span class="pl">${esc(S.side[d.si].plat)}</span>` : ''}<span class="mut">${when}</span></li>`; }).join('');
  const fbar = `<div class="fbar"><button data-sf="all" class="${stopFilter === 'all' ? 'on' : ''}">Wszystkie odjazdy</button><button data-sf="act" class="${stopFilter === 'act' ? 'on' : ''}">W drodze (${active.length})</button></div>`;
  const tabs = multi ? `<div class="sides"><button data-side="-1" class="${selSide < 0 ? 'on' : ''}">Obie strony</button>${grp.members.map(m => { const sd = S.side[m];
      return `<button data-side="${m}" class="${selSide === m ? 'on' : ''}"><b>${esc(sd.plat)}</b> ${esc(sideText(m))}${sd.next && !sd.arrOnly ? `<small>następny: ${esc(sd.next)}</small>` : ''}</button>`; }).join('')}</div>`
    : `<div class="sub">${esc(sideText(grp.members[0]))}${S.side[grp.members[0]].next ? ' · następny: ' + esc(S.side[grp.members[0]].next) : ''}</div>`;
  const routes = selSide >= 0 ? S.side[selSide].routes : grp.routeList;
  return `<button class="close" data-act="close">✕</button>
  <h2>🚏 ${esc(grp.name)}</h2><div class="sub">${multi ? grp.members.length + ' słupki · ' : ''}odjazdy w ciągu godziny · ${routes.map(r => chip(r)).join(' ')}</div>
  ${alertsHtml(alertsFor({ stops: selSide >= 0 ? [selSide] : grp.members, routes }))}
  ${tabs}
  <div class="btnrow"><button data-act="planfrom">🧭 Stąd</button><button data-act="planto">🧭 Dotąd</button><button data-act="timetable">📅 Rozkład</button><button data-act="reach" title="Dokąd dojedziesz stąd w 10, 20, 30 i 45 min">⏱ Zasięg</button>${shareBtn()}</div>
  ${fbar}
  <ul class="list">${rows || `<li class="past">${stopFilter === 'act' ? 'Teraz żaden autobus nie jedzie w stronę tego przystanku.' : 'Brak odjazdów w najbliższej godzinie.'}</li>`}</ul>`;
}
function routeSheet(ri) {
  const r = D.routes[ri];
  const mine = buses.filter(b => b.ti >= 0 && S.trips[b.ti].route === ri);
  const rows = mine.map(b => { const tr = S.trips[b.ti], ns = tr.stops[Math.min(b.k, tr.stops.length - 1)];
    return `<li data-trip="${b.ti}">${chip(ri)}<span class="grow">→ ${esc(tr.head)}</span><span class="mut">${b.at ? 'na przyst.' : 'dalej:'} ${esc(D.stops[ns][2])}</span></li>`; }).join('');
  return `<button class="close" data-act="close">✕</button>
  <h2>${chip(ri)} ${esc(r.name || '')}</h2><div class="sub">${mine.length ? `Na trasie: ${mine.length} ${mine.length === 1 ? 'autobus' : (mine.length % 10 >= 2 && mine.length % 10 <= 4 && (mine.length % 100 < 10 || mine.length % 100 >= 20)) ? 'autobusy' : 'autobusów'}` : 'Teraz brak autobusów tej linii na trasie.'}</div>
  ${alertsHtml(alertsFor({ route: ri }))}
  <div class="btnrow"><button data-act="fit">Pokaż trasę</button>${shareBtn()}</div>
  <ul class="list">${rows}</ul>`;
}

function fitShapes(shapeIdxs) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const s of shapeIdxs) { const p = S.shapes[s].pts; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); } }
  if (x0 > x1) return;
  cam.x = (x0 + x1) / 2; cam.z = -(y0 + y1) / 2;
  const ext = Math.max(x1 - x0, y1 - y0);
  const asp = innerWidth / innerHeight; cam.half = clamp(Math.max(ext * .62 / asp, ext * .62 * Math.sin(cam.elev)), 150, 7000); follow = false;
}

let selSide = -1, stopFilter = store.get('stopFilter', 'all');
function select({ trip = -1, stop = -1, route, side }) {
  selTrip = trip; selStop = stop; if (route !== undefined) selRoute = route;
  selSide = side !== undefined ? side : (stop >= 0 ? stop : -1);
  if (trip >= 0) selRoute = -1;
  if (trip < 0) follow = false;
  lastSheet = 0; renderSheet();
}

$('#sheet').addEventListener('click', e => {
  const sf = e.target.closest('[data-sf]'); if (sf) { stopFilter = sf.dataset.sf; store.set('stopFilter', stopFilter); lastSheet = 0; renderSheet(); return; }
  const pp = e.target.closest('[data-act="planprev"]'); if (pp) { planBack(); return; }
  const sd = e.target.closest('[data-side]'); if (sd) { selSide = +sd.dataset.side; lastSheet = 0; renderSheet(); return; }
  const rm = e.target.closest('[data-remind]'); if (rm && plan.sel >= 0) { toggleReminder(plan.options[plan.sel], +rm.dataset.remind); return; }
  const a = e.target.closest('[data-act],[data-stop],[data-trip]'); if (!a) return;
  if (a.dataset.act === 'share') { shareView(); return; }
  if (a.dataset.act === 'timetable') { openTimetable(); return; }
  if (a.dataset.act === 'reach') { showReach(selStop); return; }
  if (a.dataset.act === 'alerts') { e.preventDefault(); openAlerts(); return; }
  if (a.dataset.act === 'close') { select({ route: -1 }); return; }
  if (a.dataset.act === 'planclose') { plan.sel = -1; select({ route: -1 }); return; }
  if (a.dataset.act === 'planopts') { openOv('planOv'); renderPlanResults(); return; }
  if (a.dataset.act === 'planfit') { fitPlan(); return; }
  if (a.dataset.act === 'planfrom' || a.dataset.act === 'planto') {
    const g = S.groups[S.stopGroup[selStop]], p = { kind: 'stop', g: g.id, label: g.name, icon: '🚏' };
    if (a.dataset.act === 'planfrom') plan.fromP = p; else plan.toP = p;
    plan.options = []; openPlanner(); return;
  }
  if (a.dataset.act === 'follow') { follow = !follow; renderSheet(); return; }
  if (a.dataset.act === 'route') { select({ route: +a.dataset.r }); return; }
  if (a.dataset.act === 'fit') { fitShapes(selTrip >= 0 ? [S.trips[selTrip].shape] : [...S.routeShapes[selRoute]]); return; }
  if (a.dataset.stop !== undefined) { const si = +a.dataset.stop; select({ stop: si, route: -1 }); const [x, y] = D.stops[si]; cam.x = x; cam.z = -y; cam.half = Math.min(cam.half, 400); return; }
  if (a.dataset.trip !== undefined) { const ti = +a.dataset.trip; select({ trip: ti }); const b = buses.find(b => b.ti === ti); if (b) { follow = true; } else fitShapes([S.trips[ti].shape]); }
});

function pick(px, py, touch = false) {
  if (pickMode) { finishPick(px, py); return; }
  // wygrywa najbliższy cel: autobus, przystanek (kropka na dachu, wiata albo podpis);
  // palec trafia 10–20 px obok miejsca, w które celuje, więc dla dotyku strefy są większe
  let bestB = touch ? 40 : 30, bt = -1, bestS = touch ? 44 : 34, bs = -1;
  for (const b of buses) { if (b.ti < 0) continue; const [sx, sy] = worldToScreen(b.x, (b.h || 0) + busScale() * 1.5, -b.y); const d = Math.hypot(sx - px, sy - py); if (d < bestB) { bestB = d; bt = b.ti; } }
  for (const el of badgePool) {                // numer linii nad autobusem: odległość od jego prostokąta
    if (el.style.display === 'none' || el._ti === undefined) continue;
    const r = el.getBoundingClientRect(), d = Math.hypot(Math.max(r.left - px, 0, px - r.right), Math.max(r.top - py, 0, py - r.bottom));
    if (d < bestB) { bestB = d; bt = el._ti; }
  }
  {
    const roof = stopRoofY(cam.half);
    D.stops.forEach(([x, y], i) => {
      const [sx, sy] = worldToScreen(x, roof, -y), [gx, gy] = worldToScreen(x, roof / 2, -y);
      const d = Math.min(Math.hypot(sx - px, sy - py), Math.hypot(gx - px, gy - py));
      if (d < bestS) { bestS = d; bs = i; }
    });
    const tol = touch ? 22 : 6;
    for (const h of LBL.hits || []) {          // podpis: odległość od prostokąta tekstu (0 w środku)
      const [sx, sy] = worldToScreen(h.x, h.yH, -h.y);
      const dx = Math.max(sx + h.s0 - px, 0, px - (sx + h.s0 + h.w)), dy = Math.max(Math.abs(py - sy) - h.h * .6, 0), d = Math.hypot(dx, dy);
      if (d <= tol && d < bestS) { bestS = d; bs = h.stop; }
    }
  }
  if (bs >= 0 && (bt < 0 || bestS < bestB)) { select({ stop: bs, route: -1 }); return; }   // remis: wygrywa autobus, jego numer leży na wierzchu
  if (bt >= 0) { select({ trip: bt }); return; }
  if (selTrip >= 0 || selStop >= 0) select({ route: selRoute });
}

/* ---- sterowanie ---- */
const pointers = new Map(); let gesture = null, moved = 0, tapSlop = 5;   // palec drży bardziej niż mysz
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  moved = pointers.size > 1 ? 99 : 0; tapSlop = e.pointerType === 'mouse' ? 5 : 12; gesture = null; hideHint();
});
canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId); const cur = { x: e.clientX, y: e.clientY };
  if (pointers.size === 1) {
    moved += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (moved > tapSlop) { const g1 = screenToGround(prev.x, prev.y), g2 = screenToGround(cur.x, cur.y); cam.x += g1[0] - g2[0]; cam.z += g1[1] - g2[1]; follow = false; }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]; const other = a === prev ? b : a;
    const d0 = Math.hypot(prev.x - other.x, prev.y - other.y), d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
    const m0 = [(prev.x + other.x) / 2, (prev.y + other.y) / 2], m1 = [(cur.x + other.x) / 2, (cur.y + other.y) / 2];
    const g1 = screenToGround(m0[0], m0[1]), g2 = screenToGround(m1[0], m1[1]); cam.x += g1[0] - g2[0]; cam.z += g1[1] - g2[1];
    if (d1 > 0) zoomAt(m1[0], m1[1], d0 / d1);
  }
  pointers.set(e.pointerId, cur);
});
const endPtr = e => { if (!pointers.has(e.pointerId)) return; const p = pointers.get(e.pointerId); pointers.delete(e.pointerId); if (pointers.size === 0 && moved <= tapSlop && e.type === 'pointerup') pick(p.x, p.y, e.pointerType !== 'mouse'); if (pointers.size) moved = 99; saveCam(); };
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * .0015)); hideHint(); saveCam(); }, { passive: false });
let saveT = 0; function saveCam() { clearTimeout(saveT); saveT = setTimeout(() => { store.set('cam', [cam.x, cam.z, cam.yawT]); store.set('half', cam.half); }, 400); }
const rot = s => { cam.yawT += s * Math.PI / 2; saveCam(); };
const panBy = (dx, dy) => { const s = cam.half * .08, c = Math.cos(cam.yaw), si = Math.sin(cam.yaw); cam.x += (dx * c + dy * si) * s; cam.z += (-dx * si + dy * c) * s; follow = false; saveCam(); };
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'q') rot(-1); else if (k === 'e') rot(1);
  else if (k === '+' || k === '=') zoomAt(innerWidth / 2, innerHeight / 2, .8); else if (k === '-') zoomAt(innerWidth / 2, innerHeight / 2, 1.25);
  else if (k === 'w' || k === 'arrowup') panBy(0, -1); else if (k === 's' || k === 'arrowdown') panBy(0, 1);
  else if (k === 'a' || k === 'arrowleft') panBy(-1, 0); else if (k === 'd' || k === 'arrowright') panBy(1, 0);
  else if (k === ' ') { setSpeed(clock.speed ? 0 : 1); syncSpeedBtns(); e.preventDefault(); }
  else if (k === 'escape') select({ route: -1 });
  else if (k === 'l') openLines();
  else if (k === 'h') toggleFreq();
  else if (k === '/') { e.preventDefault(); openSearch(); }
  else if (k === 'p') openPlanner();});
$('#bRotL').onclick = () => rot(-1); $('#bRotR').onclick = () => rot(1);
$('#bZin').onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, .7); $('#bZout').onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1.4);
function syncSpeedBtns() { document.querySelectorAll('#speeds [data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === clock.speed)); }
$('#speeds').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.now) { clock.base = Date.now(); clock.perf = performance.now(); clock.speed = 1; } else setSpeed(+b.dataset.speed); syncSpeedBtns(); lastSheet = 0; });
function openOv(id) { $('#' + id).classList.add('show'); }
document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-close]')) o.classList.remove('show'); }));
// lista linii: wszystkie albo tylko te, których autobus jest teraz na trasie
let lineFilter = store.get('lineFilter', 'all');
function renderLines() {
  const act = new Set(buses.filter(b => b.ti >= 0).map(b => S.trips[b.ti].route));
  document.querySelectorAll('[data-lf]').forEach(b => { b.classList.toggle('on', b.dataset.lf === lineFilter); if (b.dataset.lf === 'act') b.textContent = `Aktywne (${act.size})`; });
  const list = D.routes.map((r, i) => [r, i]).filter(([, i]) => lineFilter === 'all' || act.has(i));
  $('#lineGrid').innerHTML = list.map(([r, i]) => `<span class="chip" data-r="${i}" style="background:${rgbCss(r.c)}${lineFilter === 'all' && !act.has(i) ? ';opacity:.45' : ''}" title="${esc(r.name)}">${esc(r.n)}</span>`).join('') || '<p class="note">Teraz żadna linia nie ma autobusu na trasie.</p>';
}
const openLines = () => { renderLines(); openOv('linesOv'); };
$('#bLines').onclick = openLines; $('#bSearch').onclick = openSearch;
$('#bStops').onclick = () => { openOv('stopsOv'); renderStopList($('#sq').value); };
$('#sq').addEventListener('input', e => renderStopList(e.target.value));
$('#stopList').addEventListener('click', e => listClick(e, 'stopsOv'));
$('#bPlan').onclick = openPlanner;
for (const f of ['from', 'to']) {
  const inp = fieldInput(f);
  inp.addEventListener('input', () => { plan[f === 'from' ? 'fromP' : 'toP'] = null; suggest(f); });
  inp.addEventListener('focus', () => { fieldBox(f === 'from' ? 'to' : 'from').innerHTML = ''; suggest(f); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && plan.sugg[f].length) { e.preventDefault(); setPlace(f, plan.sugg[f][0]); inp.blur(); } });
}
$('#planOv').addEventListener('click', e => {
  const act = e.target.closest('.sug [data-act]');
  if (act) { fieldBox('from').innerHTML = fieldBox('to').innerHTML = ''; if (act.dataset.act === 'gps') locate(act.dataset.f); else startPick(act.dataset.f); return; }
  const sg = e.target.closest('.sug [data-pi]');
  if (sg) { setPlace(sg.dataset.f, plan.sugg[sg.dataset.f][+sg.dataset.pi]); return; }
  if (!e.target.closest('.pf')) fieldBox('from').innerHTML = fieldBox('to').innerHTML = '';
  const o = e.target.closest('[data-o]');
  if (o) { if (+o.dataset.o !== plan.sel) planRemember(); plan.sel = +o.dataset.o; selTrip = -1; selStop = -1; selRoute = -1; follow = false; setPlanGeo(); fitPlan(); $('#planOv').classList.remove('show'); lastSheet = 0; renderSheet(); return; }
  const pa = e.target.closest('[data-pact]'); if (pa && pa.dataset.pact === 'later') runPlan(true); if (pa && pa.dataset.pact === 'prev') planBack();
});
$('#pSwap').onclick = () => { [plan.fromP, plan.toP] = [plan.toP, plan.fromP]; syncPlanFields(); runPlan(); };
$('#pNow').onclick = () => { $('#pTime').value = fmtT(warsaw(simMs()).sec); runPlan(); };
$('#pGo').onclick = () => runPlan();
$('#pTime').addEventListener('change', () => runPlan());
$('#q').addEventListener('input', e => doSearch(e.target.value));
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { const f = $('#results [data-r], #results [data-g]'); if (f) f.click(); } if (e.key === 'Escape') $('#searchOv').classList.remove('show'); });
$('#results').addEventListener('click', e => {
  const r = e.target.closest('[data-r]'), g = e.target.closest('[data-g]');
  if (r) { const ri = +r.dataset.r; select({ route: ri }); fitShapes([...S.routeShapes[ri]]); }
  else if (g) { listClick(e, 'searchOv'); return; }
  else return;
  $('#searchOv').classList.remove('show');
}); $('#bSet').onclick = () => { syncPerfNote(); openOv('setOv'); };
let hintHidden = false; function hideHint() { if (!hintHidden) { hintHidden = true; $('#hint').style.opacity = 0; } }
setTimeout(hideHint, 9000);

function syncOpts() {
  document.querySelectorAll('.seg[data-opt]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(opt[seg.dataset.opt]) === b.dataset.v)));
}
document.querySelectorAll('.seg[data-opt]').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const k = seg.dataset.opt;
  opt[k] = ['tod', 'wx', 'season'].includes(k) ? b.dataset.v : +b.dataset.v; store.set(k, opt[k]); syncOpts();
  if (k === 'wx') { if (opt.wx === 'off') renderWeather(); else startWeather(); }
}));
$('#setTime').addEventListener('change', e => {
  const [h, m] = e.target.value.split(':').map(Number); if (isNaN(h)) return;
  const ms = simMs(), w = warsaw(ms); clock.base = ms + ((h * 3600 + m * 60) - Math.floor(w.sec)) * 1000; clock.perf = performance.now(); lastSheet = 0;
});


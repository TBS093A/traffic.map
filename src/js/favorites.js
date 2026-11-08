/* ======================= LINKI, UDOSTĘPNIANIE, ULUBIONE (UI) ======================= */
function toastFor(msg, ms = 2500) { toast(msg); clearTimeout(toastFor.t); toastFor.t = setTimeout(() => toast(''), ms); }

// bieżący stan widoku do linku; czas symulacji tylko wtedy, gdy różni się od teraz
function viewState(withCam = true) {
  const ms = simMs(), off = Math.abs(ms - Date.now()) > 90000;
  const st = { stop: selStop, side: selStop >= 0 ? selSide : -1, route: selRoute, trip: selTrip,
    time: off ? warsaw(ms).sec : null, speed: clock.speed };
  if (withCam) st.cam = { x: cam.x, z: cam.z, yaw: cam.yawT, half: cam.half };
  if (plan.sel >= 0 && plan.fromP && plan.toP) { st.from = plan.fromP; st.to = plan.toP; st.at = plan.t; }
  return st;
}
function applyLink(hash) {
  if (!hash || hash.length < 2) return false;
  const st = decodeLink(hash);
  if (st.cam) { cam.x = st.cam.x; cam.z = st.cam.z; cam.yaw = cam.yawT = st.cam.yaw; cam.half = st.cam.half; }
  if (st.time != null) { const ms = Date.now(), w = warsaw(ms); clock.base = ms + (st.time - Math.floor(w.sec)) * 1000; clock.perf = performance.now(); }
  if (st.speed != null && [0, 1, 10, 60].includes(st.speed)) { setSpeed(st.speed); syncSpeedBtns(); }
  if (st.from && st.to) {
    plan.fromP = st.from; plan.toP = st.to; syncPlanFields();
    if (st.at != null) $('#pTime').value = fmtT(st.at);
    runPlan(); if (!st.cam) fitPlan();
  } else if (st.trip >= 0) { select({ trip: st.trip }); if (!st.cam) { if (buses.some(b => b.ti === st.trip)) follow = true; else fitShapes([S.trips[st.trip].shape]); } }
  else if (st.stop >= 0) { select({ stop: st.stop, route: -1, side: st.side }); if (!st.cam) { const [x, y] = D.stops[st.stop]; cam.x = x; cam.z = -y; cam.half = Math.min(cam.half, 320); } }
  else if (st.route >= 0) { select({ route: st.route }); if (!st.cam) fitShapes([...S.routeShapes[st.route]]); }
  lastSheet = 0; return true;
}
// adres w pasku przeglądarki nadąża za widokiem (bez wpisów w historii)
let linkT = 0, linkLast = '';
function syncLink(now) {
  if (now - linkT < 700 || pointers.size) return; linkT = now;
  const h = encodeLink(viewState());
  if (h === linkLast) return; linkLast = h;
  try { history.replaceState(null, '', '#' + h); } catch (e) {}
}
addEventListener('hashchange', () => { if (location.hash.slice(1) !== linkLast) { linkLast = location.hash.slice(1); applyLink(location.hash); } });

async function shareView() {
  const url = location.href.split('#')[0] + '#' + encodeLink(viewState());
  const title = selStop >= 0 ? S.groups[S.stopGroup[selStop]].name : selTrip >= 0 ? 'Linia ' + D.routes[S.trips[selTrip].route].n
    : plan.sel >= 0 ? plan.fromP.label + ' → ' + plan.toP.label : selRoute >= 0 ? 'Linia ' + D.routes[selRoute].n : 'Rzeszów w pikselach';
  try { if (navigator.share && matchMedia('(pointer:coarse)').matches) { await navigator.share({ title, url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toastFor('Skopiowano link do schowka'); }
  catch (e) { toastFor(url, 8000); }
}

/* ---- ulubione ---- */
const favStop = si => ({ type: 'stop', name: S.groups[S.stopGroup[si]].name });
const favPlan = () => ({ type: 'plan', from: encodePlace(plan.fromP), to: encodePlace(plan.toP), label: plan.fromP.label + ' → ' + plan.toP.label });
const favBtn = f => `<button data-act="fav" title="${isFav(f) ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}" aria-pressed="${isFav(f)}">${isFav(f) ? '★' : '☆'}</button>`;
const shareBtn = () => '<button data-act="share" title="Udostępnij link do tego widoku">🔗 Udostępnij</button>';
function toggleFavCurrent() {
  const f = selStop >= 0 ? favStop(selStop) : plan.sel >= 0 ? favPlan() : null; if (!f) return;
  toastFor(favToggle(f) ? 'Dodano do ulubionych ⭐' : 'Usunięto z ulubionych'); lastSheet = 0; renderSheet();
}
function renderFavs() {
  const w = warsaw(simMs()), box = $('#favList');
  if (!FAV.list.length) { box.innerHTML = '<p class="note">Nic tu jeszcze nie ma. Gwiazdka ☆ na tablicy przystanku albo w wyznaczonej trasie dodaje ją do ulubionych.</p>'; return; }
  let html = '<ul class="list">';
  FAV.list.forEach((f, i) => {
    if (f.type === 'stop') {
      const g = groupByName(f.name);
      if (!g) { html += `<li class="past" data-fi="${i}"><span class="grow">🚏 ${esc(f.name)}<br><span class="mut">brak w obecnym rozkładzie</span></span><button data-fdel="${i}" title="Usuń">✕</button></li>`; return; }
      const deps = departures(g.members[0], w, 5400).slice(0, 4);
      const next = deps.map(d => `${chip(S.trips[d.ti].route)}<span class="mut">${Math.max(0, Math.round((d.dep - w.sec) / 60))}′</span>`).join(' ');
      html += `<li data-fi="${i}"><span class="grow">🚏 <b>${esc(g.name)}</b><br>${next || '<span class="mut">brak odjazdów w ciągu 1,5 h</span>'}</span><button data-fdel="${i}" title="Usuń">✕</button></li>`;
    } else html += `<li data-fi="${i}"><span class="grow">🧭 <b>${esc(f.label)}</b><br><span class="mut">wyszukaj połączenie od teraz</span></span><button data-fdel="${i}" title="Usuń">✕</button></li>`;
  });
  box.innerHTML = html + '</ul><p class="note">Ulubione są zapisane tylko w tej przeglądarce.</p>';
}
function openFavs() { renderFavs(); openOv('favOv'); }
$('#bFav').onclick = openFavs;
$('#favList').addEventListener('click', e => {
  const del = e.target.closest('[data-fdel]');
  if (del) { FAV.list.splice(+del.dataset.fdel, 1); favSave(); renderFavs(); lastSheet = 0; return; }
  const li = e.target.closest('[data-fi]'); if (!li) return;
  const f = FAV.list[+li.dataset.fi];
  if (f.type === 'stop') { const g = groupByName(f.name); if (!g) return; focusGroup(g.id); }
  else {
    const a = decodePlace(f.from), b = decodePlace(f.to); if (!a || !b) { toastFor('Tego miejsca nie ma w obecnych danych'); return; }
    plan.fromP = a; plan.toP = b; $('#pTime').value = fmtT(warsaw(simMs()).sec); syncPlanFields(); runPlan(); fitPlan();
  }
  $('#favOv').classList.remove('show');
});

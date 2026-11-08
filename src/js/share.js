/* ======================= LINKI I UDOSTĘPNIANIE (UI) ======================= */
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

const shareBtn = () => '<button data-act="share" title="Udostępnij link do tego widoku">🔗 Udostępnij</button>';

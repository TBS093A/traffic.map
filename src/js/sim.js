/* ======================= STAN APLIKACJI ======================= */
let selRoute = -1, selTrip = -1, selStop = -1, follow = false;
let buses = [];        // {ti, x, y, dx, dy, live, delay}
const live = { url: store.get('liveUrl', ''), map: new Map(), extra: [], timer: null, last: 0, status: '', tu: new Map(), alerts: [] };
let hlGeo = null, hlKey = '', staticBox, stopBox, dynBox, groundV, roadV, roadCount = 0;
const dyn = new Float32Array(1200 * 12);

function sunState(month, sec) {
  const RS = [[7.5,15.9],[6.9,16.8],[5.9,17.6],[5.8,19.4],[4.9,20.2],[4.4,20.7],[4.6,20.6],[5.3,19.9],[6.0,18.8],[6.8,17.6],[6.6,15.9],[7.3,15.5]][month - 1];
  const h = sec / 3600;
  let night = 1 - smooth(RS[0] - .5, RS[0] + .7, h) * (1 - smooth(RS[1] - .7, RS[1] + .5, h));
  if (opt.tod === 'day') night = 0; if (opt.tod === 'night') night = 1;
  const dayF = opt.tod === 'day' ? .5 : clamp((h - RS[0]) / (RS[1] - RS[0]), 0, 1);
  const az = lerp(-1.3, 1.3, dayF), el = .25 + .6 * Math.sin(Math.PI * dayF);
  const sun = [-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const golden = Math.max(0, 1 - Math.abs(night - .5) * 2.4);
  const amb = [lerp(.56, .2, night) + golden * .1, lerp(.58, .23, night) + golden * .03, lerp(.64, .38, night)];
  const sc = (1 - night);
  const sunCol = [.52 * sc + golden * .12, .5 * sc, .44 * sc - golden * .05];
  return { night, sun, amb, sunCol };
}

function computeBuses(ms) {
  const w = warsaw(ms), today = servicesFor(w.ymd), yest = servicesFor(ymdShift(w.ymd, -1));
  const svToday = new Set(today.svs.map(s => D.services.indexOf(s))), svYest = new Set(yest.svs.map(s => D.services.indexOf(s)));
  const t = w.sec, out = [], pt = {};
  const nowEpoch = ms / 1000, liveFresh = live.map.size && (Date.now() - live.last < 90000);
  for (let ti = 0; ti < S.trips.length; ti++) {
    const tr = S.trips[ti]; let tt;
    const lv = liveFresh ? live.map.get(tr.id) : null;
    if (svToday.has(tr.service)) tt = t; else if (svYest.has(tr.service)) tt = t + 86400; else continue;
    let delay = 0;
    if (lv) { delay = lv.delay; if (tt - delay < tr.start - 60 || tt - delay > tr.end + 120) continue; }
    else if (tt < tr.start || tt > tr.end) continue;
    const st = tripDist(tr, tt - delay);
    pointAt(S.shapes[tr.shape], st.d, pt);
    const x = pt.x + pt.dy * 2.2, y = pt.y - pt.dx * 2.2;
    out.push({ ti, x, y, h: bridgeAt(x, y, pt.dx, pt.dy), dx: pt.dx, dy: pt.dy, live: !!lv, delay, k: st.k, at: st.at, d: st.d, tt });
  }
  if (liveFresh) for (const v of live.extra) out.push({ ti: -1, x: v.x, y: v.y, dx: Math.cos(v.a), dy: Math.sin(v.a), live: true, label: v.label });
  return { buses: out, w, fallback: today.fallback };
}

const busScale = () => cam.half > 1500 ? 2.2 : cam.half > 700 ? 1.5 : 1;   // autobusy rosną przy oddaleniu, żeby było je widać
function fillDyn() {
  const po = plan.sel >= 0 ? plan.options[plan.sel] : null, planTrips = new Set(po ? po.legs.filter(l => l.type === 'ride').map(l => l.ti) : []);
  let o = 0; const n = Math.min(buses.length, 1100);
  for (let i = 0; i < n; i++) {
    const b = buses[i], tr = b.ti >= 0 ? S.trips[b.ti] : null;
    const col = tr ? D.routes[tr.route].c : [150, 150, 150];
    const dim = selRoute >= 0 && tr && tr.route !== selRoute;
    const sel = (b.ti === selTrip && selTrip >= 0) || (selRoute >= 0 && tr && tr.route === selRoute) || planTrips.has(b.ti);
    const s = busScale();
    const c = dim ? [140, 140, 150] : col;
    dyn.set([b.x, 0.15 + (b.h || 0), -b.y, Math.atan2(b.dy, b.dx), 12 * s, 3.1 * s, 2.6 * s, sel ? 5 : 4, c[0] / 255, c[1] / 255, c[2] / 255, 0], o); o += 12;
  }
  if (selStop >= 0) { const [x, y] = D.stops[selStop]; dyn.set([x, 0, -y, 0, 5, 7, 5, 6, 1, 1, 1, 0], o); o += 12; }
  for (const si of planStops()) { const [x, y] = D.stops[si]; dyn.set([x, 0, -y, 0, 4, 9, 4, 6, 1, 1, 1, 0], o); o += 12; }
  return o / 12;
}

function setHighlight() {
  let key = '', shapes = [];
  if (selTrip >= 0) { key = 't' + selTrip; shapes = [S.trips[selTrip].shape]; }
  else if (selRoute >= 0) { key = 'r' + selRoute; shapes = [...S.routeShapes[selRoute]]; }
  if (key === hlKey) return; hlKey = key;
  if (hlGeo) { gl.deleteVertexArray(hlGeo.vao); gl.deleteBuffer(hlGeo.buf); hlGeo = null; }
  if (!shapes.length) return;
  const g = stripGeo(shapes);
  hlGeo = vaoFrom(g, STRIP); hlGeo.count = g.length / 7;
}


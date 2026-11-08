/* ======================= DANE ======================= */
async function loadData() {
  const b64 = $('#gtfs').textContent.trim();
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

let D; // dane
const S = { shapes: [], trips: [], routeShapes: [], stopTrips: [], tripById: new Map(), dayType: {} };

function prepData() {
  for (const flat of D.shapes) {
    const n = flat.length / 2, pts = new Float32Array(flat), cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    S.shapes.push({ pts, cum, len: cum[n - 1] });
  }
  S.routeShapes = D.routes.map(() => new Set());
  S.stopTrips = D.stops.map(() => []);
  D.trips.forEach((t, ti) => {
    const [route, service, pat, head, brig, id, t0, deltas] = t;
    const times = new Int32Array(deltas.length + 1); times[0] = t0;
    for (let i = 0; i < deltas.length; i++) times[i + 1] = times[i] + deltas[i];
    const P = D.patterns[pat];
    const trip = { route, service, pat, shape: P[0], stops: P[1], dist: P[2], head: D.heads[head], brig, id, times, start: times[0], end: times[times.length - 1] };
    S.trips.push(trip); S.tripById.set(id, ti);
    S.routeShapes[route].add(P[0]);
    P[1].forEach((si, k) => S.stopTrips[si].push(ti * 256 + k));
  });
  // typy dni z kalendarza feedu (fallback dla dat spoza feedu)
  for (const [ymd, svs] of Object.entries(D.dates)) {
    const wd = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay();
    const type = wd === 6 ? 'sat' : wd === 0 ? 'sun' : 'wd';
    if (!S.dayType[type]) S.dayType[type] = { ymd, svs };
  }
}

function pointAt(sh, d, out) {
  const { pts, cum } = sh; const n = cum.length;
  d = clamp(d, 0, sh.len);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
  const segL = cum[hi] - cum[lo] || 1, f = (d - cum[lo]) / segL;
  const ax = pts[2 * lo], ay = pts[2 * lo + 1], bx = pts[2 * hi], by = pts[2 * hi + 1];
  out.x = ax + (bx - ax) * f; out.y = ay + (by - ay) * f;
  out.dx = (bx - ax) / segL; out.dy = (by - ay) / segL;
  return out;
}

// pozycja kursu wzdłuż trasy w czasie t (sekundy doby rozkładowej)
function tripDist(tr, t) {
  const T = tr.times, Dd = tr.dist, n = T.length;
  if (t <= T[0]) return { d: Dd[0], k: 0, at: true };
  if (t >= T[n - 1]) return { d: Dd[Dd.length - 1], k: Dd.length - 1, at: true };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
  if (lo % 2 === 0) return { d: Dd[lo / 2], k: lo / 2, at: true };   // postój na przystanku
  const k = (lo - 1) / 2, span = T[lo + 1] - T[lo];
  const f = span > 0 ? (t - T[lo]) / span : 0;
  return { d: Dd[k] + (Dd[k + 1] - Dd[k]) * f, k: k + 1, at: false };
}
// odwrotność: rozkładowy czas, w którym kurs jest w odległości d
function tripTimeAt(tr, d) {
  const Dd = tr.dist, T = tr.times;
  if (d <= Dd[0]) return T[1];
  for (let k = 0; k < Dd.length - 1; k++) {
    if (d <= Dd[k + 1]) { const span = Dd[k + 1] - Dd[k]; const f = span > 0 ? (d - Dd[k]) / span : 1; return T[2 * k + 1] + (T[2 * k + 2] - T[2 * k + 1]) * f; }
  }
  return T[T.length - 1];
}
function projectOnShape(sh, x, y) {
  const { pts, cum } = sh; let best = 1e18, bd = 0;
  for (let i = 0; i < cum.length - 1; i++) {
    const ax = pts[2 * i], ay = pts[2 * i + 1], dx = pts[2 * i + 2] - ax, dy = pts[2 * i + 3] - ay;
    const L2 = dx * dx + dy * dy, t = L2 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0;
    const e = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (e < best) { best = e; bd = cum[i] + t * Math.sqrt(L2); }
  }
  return { d: bd, err: best };
}
const fmtT = s => { s = ((s % 86400) + 86400) % 86400; const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
const rgbCss = c => `rgb(${c[0]},${c[1]},${c[2]})`;


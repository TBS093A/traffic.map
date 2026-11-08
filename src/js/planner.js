/* ======================= PLANER POŁĄCZEŃ (RAPTOR) ======================= */
// Round-based Public Transit Routing: runda k = najlepsze dojazdy z co najwyżej k przejazdami.
// Start/cel: przystanek, punkt (adres, GPS, wskazanie) albo cała ulica — z dojściem pieszym do 1 km.
const plan = { fromP: null, toP: null, t: null, options: [], sel: -1, geo: [], key: '', sugg: { from: [], to: [] }, me: null, hist: [] };
const WALK_MAX = 400, ACCESS_R = 1000, DIRECT_WALK = 2500, MAX_ROUNDS = 4, HORIZON = 4 * 3600, MIN_CHANGE = 60;
const walkSec = d => Math.round(d * 1.25 / 1.2);

function raptorIndex() {
  S.patTrips = D.patterns.map(() => []);
  S.trips.forEach((t, ti) => S.patTrips[t.pat].push(ti));
  S.patByStop = D.stops.map(() => []);
  D.patterns.forEach((P, pi) => P[1].forEach((s, i) => { if (i < P[1].length - 1) S.patByStop[s].push([pi, i]); }));
  S.walk = D.stops.map(() => []);
  const cell = WALK_MAX, grid = new Map(), key = (a, b) => a + ',' + b;
  D.stops.forEach(([x, y], i) => { const k = key(Math.floor(x / cell), Math.floor(y / cell)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  D.stops.forEach(([x, y], i) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of grid.get(key(gx + a, gy + b)) || []) {
      if (j === i) continue; const d = Math.hypot(D.stops[j][0] - x, D.stops[j][1] - y);
      if (d <= WALK_MAX) S.walk[i].push([j, walkSec(d) + 30]);
    }
  });
}
const placePts = p => p.kind === 'stop' ? S.groups[p.g].members.flatMap(m => [D.stops[m][0], D.stops[m][1]]) : p.kind === 'point' ? [p.x, p.y] : p.pts;
function accessFor(p) {
  if (p.kind === 'stop') return S.groups[p.g].members.map(m => ({ s: m, w: 0, x: D.stops[m][0], y: D.stops[m][1], d: 0 }));
  const pts = placePts(p), all = [];
  D.stops.forEach(([sx, sy], s) => {
    let bd = 1e18, bx = 0, by = 0;
    for (let i = 0; i < pts.length; i += 2) { const d = (pts[i] - sx) ** 2 + (pts[i + 1] - sy) ** 2; if (d < bd) { bd = d; bx = pts[i]; by = pts[i + 1]; } }
    all.push({ s, w: walkSec(Math.sqrt(bd)), x: bx, y: by, d: Math.sqrt(bd) });
  });
  const near = all.filter(a => a.d <= ACCESS_R);
  return near.length ? near : all.sort((a, b) => a.d - b.d).slice(0, 3);
}
function closestPair(a, b) {
  let bd = 1e18, r = null;
  for (let i = 0; i < a.length; i += 2) for (let j = 0; j < b.length; j += 2) {
    const d = (a[i] - b[j]) ** 2 + (a[i + 1] - b[j + 1]) ** 2; if (d < bd) { bd = d; r = [a[i], a[i + 1], b[j], b[j + 1]]; }
  }
  return { d: Math.sqrt(bd), p: r };
}

function planRoute(fromP, toP, ymd, t0) {
  const today = servicesFor(ymd), yest = servicesFor(ymdShift(ymd, -1));
  const svT = new Set(today.svs.map(s => D.services.indexOf(s))), svY = new Set(yest.svs.map(s => D.services.indexOf(s)));
  const patCache = new Map();
  const tripsOf = pi => {
    let l = patCache.get(pi); if (l) return l; l = [];
    for (const ti of S.patTrips[pi]) {
      const tr = S.trips[ti]; let off;
      if (typeof routeOn === 'function' && !routeOn(tr.route)) continue;   // wyłączony tryb (np. pociągi) nie wchodzi do planu
      if (svT.has(tr.service)) off = 0; else if (svY.has(tr.service)) off = -86400; else continue;
      if (tr.end + off < t0 || tr.start + off > t0 + HORIZON) continue;
      l.push([ti, off]);
    }
    l.sort((a, b) => (S.trips[a[0]].times[1] + a[1]) - (S.trips[b[0]].times[1] + b[1]));
    patCache.set(pi, l); return l;
  };
  const N = D.stops.length, INF = 1e12;
  const src = accessFor(fromP), dst = accessFor(toP), dstMap = new Map();
  for (const e of dst) if (!dstMap.has(e.s) || dstMap.get(e.s).w > e.w) dstMap.set(e.s, e);
  const best = new Float64Array(N).fill(INF);
  let bestDest = INF; const rounds = [], results = [];
  // wariant pieszy
  const cp = closestPair(placePts(fromP), placePts(toP));
  if (cp.d <= DIRECT_WALK) {
    const w = walkSec(cp.d);
    results.push({ legs: [{ type: 'walk', from: null, to: null, fromXY: cp.p.slice(0, 2), toXY: cp.p.slice(2), fromName: fromP.label, toName: toP.label, dur: w, dep: t0, arr: t0 + w }], dep: t0, arr: t0 + w, transfers: 0, rides: 0 });
    bestDest = t0 + w;
  }
  const arr0 = new Float64Array(N).fill(INF), par0 = new Array(N);
  let marked = new Set();
  for (const a of src) if (t0 + a.w < arr0[a.s]) { arr0[a.s] = t0 + a.w; best[a.s] = arr0[a.s]; par0[a.s] = { type: 'access', a }; marked.add(a.s); }
  const relaxWalks = (arr, par, from, k, markedOut) => {
    for (const s of from) for (const [t, w] of S.walk[s]) {
      const a = arr[s] + w;
      if (a < best[t] && a < bestDest) { arr[t] = a; best[t] = a; par[t] = { type: 'walk', from: s, dur: w, k }; markedOut.add(t); }
    }
  };
  relaxWalks(arr0, par0, [...marked], 0, marked);
  rounds.push({ arr: arr0, par: par0 });
  const destBest = arr => { let bd = INF, be = null; for (const [s, e] of dstMap) { const v = arr[s] + e.w; if (v < bd) { bd = v; be = e; } } return [bd, be]; };
  for (let k = 1; k <= MAX_ROUNDS && marked.size; k++) {
    const prev = rounds[k - 1], cur = Float64Array.from(prev.arr), par = prev.par.slice();
    const Q = new Map();
    for (const s of marked) for (const [pi, i] of S.patByStop[s]) if (!Q.has(pi) || Q.get(pi) > i) Q.set(pi, i);
    const rideMarked = new Set();
    for (const [pi, i0] of Q) {
      const stops = D.patterns[pi][1], list = tripsOf(pi); if (!list.length) continue;
      let trip = -1, off = 0, boardI = -1;
      for (let i = i0; i < stops.length; i++) {
        const s = stops[i];
        if (trip >= 0) {
          const a = S.trips[trip].times[2 * i] + off;
          if (a < best[s] && a < bestDest) { cur[s] = a; best[s] = a; par[s] = { type: 'ride', ti: trip, off, from: boardI, to: i, boardStop: stops[boardI], k }; rideMarked.add(s); }
        }
        if (i < stops.length - 1 && prev.arr[s] < INF) {
          const ready = prev.arr[s] + (prev.par[s] && prev.par[s].type === 'ride' ? MIN_CHANGE : 0);
          const curDep = trip >= 0 ? S.trips[trip].times[2 * i + 1] + off : INF;
          if (ready <= curDep) {
            for (const [ti, o] of list) { const d = S.trips[ti].times[2 * i + 1] + o; if (d >= ready) { if (d < curDep) { trip = ti; off = o; boardI = i; } break; } }
          }
        }
      }
    }
    const newMarked = new Set(rideMarked);
    relaxWalks(cur, par, [...rideMarked], k, newMarked);
    rounds.push({ arr: cur, par });
    const [bd, be] = destBest(cur);
    if (bd < bestDest) {
      const r = reconstruct(rounds, k, be, t0, fromP, toP);
      if (r.rides > 0) { bestDest = bd; results.push(r); }
    }
    marked = newMarked;
  }
  return results;
}

function reconstruct(rounds, k, egress, t0, fromP, toP) {
  const legs = []; let cur = egress.s, kk = k, guard = 0;
  const stopXY = s => [D.stops[s][0], D.stops[s][1]];
  while (guard++ < 40) {
    const p = rounds[kk].par[cur];
    if (!p) break;
    if (p.type === 'access') {
      if (p.a.w > 0) legs.push({ type: 'walk', from: null, to: cur, fromXY: [p.a.x, p.a.y], toXY: stopXY(cur), fromName: fromP.label, toName: D.stops[cur][2], dur: p.a.w });
      break;
    }
    if (p.type === 'walk') { legs.push({ type: 'walk', from: p.from, to: cur, fromXY: stopXY(p.from), toXY: stopXY(cur), fromName: D.stops[p.from][2], toName: D.stops[cur][2], dur: p.dur }); cur = p.from; kk = p.k; continue; }
    legs.push({ type: 'ride', ti: p.ti, off: p.off, from: p.from, to: p.to }); cur = p.boardStop; kk = p.k - 1;
  }
  legs.reverse();
  if (egress.w > 0) legs.push({ type: 'walk', from: egress.s, to: null, fromXY: stopXY(egress.s), toXY: [egress.x, egress.y], fromName: D.stops[egress.s][2], toName: toP.label, dur: egress.w });
  // sklej kolejne przejścia piesze w jedno (z punktem pośrednim do rysowania)
  for (let i = legs.length - 1; i > 0; i--) {
    const a = legs[i - 1], b = legs[i];
    if (a.type === 'walk' && b.type === 'walk') legs.splice(i - 1, 2, { ...a, to: b.to, toXY: b.toXY, toName: b.toName, dur: a.dur + b.dur, via: [...(a.via || []), ...a.toXY, ...(b.via || [])] });
  }
  for (const L of legs) if (L.type === 'ride') { const tr = S.trips[L.ti]; L.dep = tr.times[2 * L.from + 1] + L.off; L.arr = tr.times[2 * L.to] + L.off; L.route = tr.route; L.fromStop = tr.stops[L.from]; L.toStop = tr.stops[L.to]; }
  let t = null;
  legs.forEach((L, i) => {
    if (L.type === 'ride') { t = L.arr; return; }
    if (t === null) { const nx = legs.slice(i + 1).find(x => x.type === 'ride'); const end = nx ? nx.dep - legs.slice(i + 1, legs.indexOf(nx)).reduce((a, x) => a + x.dur, 0) : t0 + L.dur; L.dep = end - L.dur; L.arr = end; t = L.arr; }
    else { L.dep = t; L.arr = t + L.dur; t = L.arr; }
  });
  const rides = legs.filter(l => l.type === 'ride');
  return { legs, dep: legs.length ? legs[0].dep : t0, arr: legs.length ? legs[legs.length - 1].arr : t0, transfers: Math.max(0, rides.length - 1), rides: rides.length };
}


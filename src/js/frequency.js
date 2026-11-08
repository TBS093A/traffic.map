/* ======================= CZĘSTOTLIWOŚĆ I ZASIĘG (logika) ======================= */

// kursy na godzinę na każdej trasie (kształcie) wokół godziny sec: odjazdy z pętli w oknie ±30 min
function routeFrequency(ymd, sec) {
  const today = servicesFor(ymd), yest = servicesFor(ymdShift(ymd, -1));
  const svT = new Set(today.svs.map(s => D.services.indexOf(s))), svY = new Set(yest.svs.map(s => D.services.indexOf(s)));
  const per = new Map();
  for (const tr of S.trips) {
    let st = tr.start;
    if (svT.has(tr.service)) { /* dziś */ } else if (svY.has(tr.service)) st -= 86400; else continue;
    if (st - sec >= -1800 && st - sec < 1800) per.set(tr.shape, (per.get(tr.shape) || 0) + 1);
  }
  return per;
}
const FREQ_BANDS = [[10, [230, 60, 50], 'co 6 min lub częściej'], [7, [240, 140, 50], 'co 7–8 min'], [5, [240, 210, 80], 'co 10–12 min'],
  [3, [120, 200, 90], 'co 15–20 min'], [1, [90, 150, 230], 'rzadziej']];
const freqBand = n => FREQ_BANDS.findIndex(([min]) => n >= min);

// Zasięg: najwcześniejszy przyjazd na każdy słupek z miejsca startu (RAPTOR bez celu, do 3 przesiadek).
// Zwraca czasy podróży [s] (Infinity, gdy poza zasięgiem maxSec).
function reachFrom(fromP, ymd, t0, maxSec, rounds = 4) {
  const today = servicesFor(ymd), yest = servicesFor(ymdShift(ymd, -1));
  const svT = new Set(today.svs.map(s => D.services.indexOf(s))), svY = new Set(yest.svs.map(s => D.services.indexOf(s)));
  const N = D.stops.length, INF = Infinity, limit = t0 + maxSec;
  const best = new Float64Array(N).fill(INF), viaRide = new Uint8Array(N);
  let marked = new Set();
  for (const a of accessFor(fromP)) if (a.d <= 600 && t0 + a.w < best[a.s]) { best[a.s] = t0 + a.w; marked.add(a.s); }
  const walk = from => { const out = new Set(); for (const s of from) for (const [t, w] of S.walk[s]) { const a = best[s] + w; if (a < best[t] && a <= limit) { best[t] = a; viaRide[t] = 0; out.add(t); } } return out; };
  for (const s of walk([...marked])) marked.add(s);
  const tripsCache = new Map();
  const tripsOf = pi => {
    let l = tripsCache.get(pi); if (l) return l; l = [];
    for (const ti of S.patTrips[pi]) {
      const tr = S.trips[ti]; let off;
      if (svT.has(tr.service)) off = 0; else if (svY.has(tr.service)) off = -86400; else continue;
      if (tr.end + off < t0 || tr.start + off > limit) continue;
      l.push([ti, off]);
    }
    l.sort((a, b) => (S.trips[a[0]].times[1] + a[1]) - (S.trips[b[0]].times[1] + b[1]));
    tripsCache.set(pi, l); return l;
  };
  for (let k = 1; k <= rounds && marked.size; k++) {
    const prev = Float64Array.from(best), Q = new Map(), next = new Set();
    for (const s of marked) for (const [pi, i] of S.patByStop[s]) if (!Q.has(pi) || Q.get(pi) > i) Q.set(pi, i);
    for (const [pi, i0] of Q) {
      const stops = D.patterns[pi][1], list = tripsOf(pi); if (!list.length) continue;
      let trip = -1, off = 0;
      for (let i = i0; i < stops.length; i++) {
        const s = stops[i];
        if (trip >= 0) { const a = S.trips[trip].times[2 * i] + off; if (a < best[s] && a <= limit) { best[s] = a; viaRide[s] = 1; next.add(s); } }
        if (i < stops.length - 1 && prev[s] < INF) {
          const ready = prev[s] + (viaRide[s] ? MIN_CHANGE : 0), curDep = trip >= 0 ? S.trips[trip].times[2 * i + 1] + off : INF;
          if (ready <= curDep) for (const [ti, o] of list) { const d = S.trips[ti].times[2 * i + 1] + o; if (d >= ready) { if (d < curDep) { trip = ti; off = o; } break; } }
        }
      }
    }
    for (const s of walk([...next])) next.add(s);
    marked = next;
  }
  for (let i = 0; i < N; i++) best[i] = best[i] === INF ? INF : best[i] - t0;
  return best;
}
const ISO_BANDS = [[600, [80, 220, 120], '10 min'], [1200, [200, 230, 90], '20 min'], [1800, [250, 190, 70], '30 min'], [2700, [240, 110, 70], '45 min']];

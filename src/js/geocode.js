/* ======================= GEOKODER ======================= */
// Adresy z OSM (jeśli pipeline je dołączył) albo — awaryjnie — ulice z danych przystanków.
const GEO = { streets: [], hasNums: false };
function buildGeo() {
  const words = n => n.split(/[\s.\-/]+/).filter(Boolean);
  if (D.addr && D.addr.length) {
    for (const [name, city, nums, flat] of D.addr) GEO.streets.push({ name, city, n: norm(name), words: words(norm(name)), cn: norm(city), nums: nums.split('|'), pts: flat, src: 'osm' });
  } else {
    const m = new Map();
    D.stops.forEach(s => { const st = s[4]; if (!st) return; if (!m.has(st)) m.set(st, []); m.get(st).push(s[0], s[1]); });
    for (const [name, flat] of m) GEO.streets.push({ name, city: '', n: norm(name), words: words(norm(name)), cn: '', nums: [], pts: flat, src: 'stops' });
  }
  GEO.hasNums = GEO.streets.some(s => s.nums.length);
}
const STREET_PREFIX = /^(ul\.?|ulica|al\.?|aleja|aleje|pl\.?|plac|os\.?|osiedle|rondo)\s+/;
function parseAddr(q) {
  let city = ''; const ci = q.indexOf(',');
  if (ci >= 0) { city = norm(q.slice(ci + 1).trim()); q = q.slice(0, ci); }
  let num = null; const m = q.trim().match(/^(.*?)\s+(\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?)$/);
  if (m) { q = m[1]; num = m[2].toLowerCase(); }
  const t = norm(q.trim()).replace(STREET_PREFIX, '');
  return { words: t.split(/[\s.\-/]+/).filter(Boolean), num, city };
}
function matchStreets(words, city) {
  const res = [];
  for (const s of GEO.streets) {
    let score = 0, ok = true;
    for (const w of words) {
      const hit = s.words.findIndex(x => x.startsWith(w));
      if (hit < 0) { ok = false; break; }
      score += (s.words[hit] === w ? 3 : 1) + (hit === s.words.length - 1 ? 2 : 0);
    }
    if (!ok) continue;
    if (city) { if (!s.cn.startsWith(city)) continue; score += 2; } else if (s.cn === 'rzeszow') score += 1;
    res.push([score - s.words.length * .3 + Math.min(s.pts.length, 400) / 4000, s]);
  }
  return res.sort((a, b) => b[0] - a[0]).map(r => r[1]);
}
function findNumber(s, num) {
  const i = s.nums.indexOf(num); if (i >= 0) return { i, exact: true };
  const n = parseInt(num, 10); if (isNaN(n)) return null;
  let best = -1, bd = 1e9;
  s.nums.forEach((x, j) => { const v = parseInt(x, 10); if (isNaN(v)) return; const d = Math.abs(v - n) + (v % 2 === n % 2 ? 0 : .5); if (d < bd) { bd = d; best = j; } });
  return best >= 0 ? { i: best, exact: false } : null;
}
function samplePts(flat, max) {
  const n = flat.length / 2; if (n <= max) return flat;
  const out = []; for (let k = 0; k < max; k++) { const i = Math.floor(k * n / max); out.push(flat[2 * i], flat[2 * i + 1]); } return out;
}
function geocode(q) {
  const p = parseAddr(q), out = [];
  if (!p.words.length) return out;
  for (const s of matchStreets(p.words, p.city).slice(0, 5)) {
    const city = s.city ? ', ' + s.city : '';
    if (p.num && s.nums.length) {
      const f = findNumber(s, p.num);
      if (f) out.push({ kind: 'point', x: s.pts[2 * f.i], y: s.pts[2 * f.i + 1], label: `${s.name} ${s.nums[f.i]}${city}`, icon: '📍', note: f.exact ? '' : `brak nr ${p.num}, najbliższy` });
    }
    out.push({ kind: 'area', pts: samplePts(s.pts, 120), label: `${s.name}${city}`, icon: '🛣', note: s.src === 'stops' ? 'ulica (wg przystanków)' : 'dowolne miejsce na ulicy' });
  }
  return out;
}
function reverseGeocode(x, y) {
  let best = null, bd = 90;
  if (GEO.hasNums) for (const s of GEO.streets) for (let i = 0; i < s.pts.length; i += 2) {
    const d = Math.hypot(s.pts[i] - x, s.pts[i + 1] - y); if (d < bd) { bd = d; best = `${s.name} ${s.nums[i / 2]}`; }
  }
  if (best) return best;
  let g = null; bd = 400;
  for (const gr of S.groups) { const d = Math.hypot(gr.x - x, gr.y - y); if (d < bd) { bd = d; g = gr; } }
  return g ? `okolice: ${g.name}` : 'Punkt na mapie';
}


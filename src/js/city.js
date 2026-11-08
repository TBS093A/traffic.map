/* ======================= MIASTO POGLĄDOWE (proceduralne) ======================= */
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hex3 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
function hashN(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hashN(ix, iy), hashN(ix + 1, iy), fx), lerp(hashN(ix, iy + 1), hashN(ix + 1, iy + 1), fx), fy); }

const G = 8, EXT = 5200, GN = Math.ceil(2 * EXT / G);
let gridDist, gridAng;
function buildGrid() {
  gridDist = new Uint8Array(GN * GN).fill(255); gridAng = new Float32Array(GN * GN);
  const q = new Int32Array(GN * GN); let qt = 0;
  for (const { pts, cum } of S.shapes) for (let i = 0; i < cum.length - 1; i++) {
    const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * i + 2], by = pts[2 * i + 3];
    const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 3)), a = Math.atan2(by - ay, bx - ax);
    for (let s = 0; s <= n; s++) {
      const x = ax + (bx - ax) * s / n, y = ay + (by - ay) * s / n;
      const gx = Math.floor((x + EXT) / G), gy = Math.floor((y + EXT) / G);
      if (gx < 0 || gy < 0 || gx >= GN || gy >= GN) continue;
      const id = gy * GN + gx; if (gridDist[id] !== 0) { gridDist[id] = 0; gridAng[id] = a; q[qt++] = id; }
    }
  }
  let qh = 0;
  while (qh < qt) {
    const id = q[qh++], d = gridDist[id]; if (d >= 24) continue;
    const gx = id % GN, gy = (id / GN) | 0;
    const nb = [gx > 0 ? id - 1 : -1, gx < GN - 1 ? id + 1 : -1, gy > 0 ? id - GN : -1, gy < GN - 1 ? id + GN : -1];
    for (const j of nb) if (j >= 0 && gridDist[j] > d + 1) { gridDist[j] = d + 1; gridAng[j] = gridAng[id]; q[qt++] = j; }
  }
}
const cellAt = (x, y) => { const gx = Math.floor((x + EXT) / G), gy = Math.floor((y + EXT) / G); return (gx < 0 || gy < 0 || gx >= GN || gy >= GN) ? -1 : gy * GN + gx; };

function buildCity() {
  const rnd = mulberry(20261107), occ = new Uint8Array(GN * GN), inst = [];
  const WALL_C = ['#d9c7a3','#cfb38a','#e3d5b8','#c9a27a','#e8dcc4','#b9a68c','#d8b98e','#c7b8a3','#d6c0a8'].map(hex3);
  const WALL_B = ['#e6e2d8','#d6d2c8','#cfd6dc','#e3d9c0','#c9cfc2','#dccfb5'].map(hex3);
  const WALL_H = ['#e8e0cc','#d9c9a8','#f0ead8','#cdbfa5','#e0d4bc'].map(hex3);
  const TREE = ['#2f5a33','#3b6d38','#46803f','#557f3a','#2c4f30'].map(hex3);
  const pick = a => a[Math.floor(rnd() * a.length)];
  function rectOK(cx, cy, a, hl, hw, minD, mark) {
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let u = -hl; u <= hl + .01; u += Math.min(4, hl)) for (let v = -hw; v <= hw + .01; v += Math.min(4, hw)) {
      const i = cellAt(cx + u * ca - v * sa, cy + u * sa + v * ca);
      if (mark) { if (i >= 0) occ[i] = 1; continue; }
      if (i < 0 || gridDist[i] < minD || occ[i]) return false;
    }
    return true;
  }
  const push = (x, y, base, a, l, h, w, kind, col, seed) => inst.push(x, base, -y, a, l, h, w, kind, col[0], col[1], col[2], seed);
  let nb = 0;
  for (let gy = -EXT + 100; gy < EXT - 100; gy += 20) for (let gx = -EXT + 100; gx < EXT - 100; gx += 20) {
    const x = gx + (rnd() - .5) * 6, y = gy + (rnd() - .5) * 6, i = cellAt(x, y); if (i < 0) continue;
    const d = gridDist[i]; const r = Math.hypot(x, y);
    if (d < 2 || (d > 11 && r > 1400)) continue;
    let p = .12 + .85 * Math.exp(-r / 1700); if (d > 6) p *= (r > 1400 ? .55 : .7);
    if (rnd() > p) continue;
    const a = gridAng[i] + (rnd() < .12 ? Math.PI / 2 : 0);
    let l, w, h, kind, col; const t = rnd();
    if (r < 900) { l = 13 + rnd() * 8; w = 12 + rnd() * 7; h = (3 + Math.floor(rnd() * 3)) * 3.2; kind = rnd() < .55 ? 7 : 0; col = pick(WALL_C); }
    else if (r < 4200 && t < .2) { l = 36 + rnd() * 34; w = 11 + rnd() * 3; h = (rnd() < .3 ? 11 : rnd() < .5 ? 5 : 4) * 2.9; kind = 0; col = pick(WALL_B); }
    else if (t < .24) { l = 35 + rnd() * 30; w = 22 + rnd() * 16; h = 6 + rnd() * 3; kind = 8; col = hex3('#b8bcc0'); }
    else { l = 9 + rnd() * 4; w = 8 + rnd() * 3; h = (1 + Math.floor(rnd() * 2)) * 3 + .6; kind = 7; col = pick(WALL_H); }
    for (const sc of [1, .8, .65]) {
      const hl = l * sc / 2, hw = w * sc / 2;
      if (hl < 4 || hw < 3.5) break;
      if (rectOK(x, y, a, hl, hw, 2, false)) { rectOK(x, y, a, hl + 2, hw + 2, 0, true); push(x, y, 0, a, hl * 2, h, hw * 2, kind, col, Math.floor(rnd() * 997)); nb++; break; }
    }
  }
  let nt = 0;
  for (let gy = -EXT + 60; gy < EXT - 60; gy += 13) for (let gx = -EXT + 60; gx < EXT - 60; gx += 13) {
    if (nt > 26000) break;
    const x = gx + (rnd() - .5) * 8, y = gy + (rnd() - .5) * 8, i = cellAt(x, y); if (i < 0 || occ[i]) continue;
    const d = gridDist[i]; if (d < 2) continue;
    const park = vnoise(x / 260, y / 260), r = Math.hypot(x, y);
    let p = (d > 18 ? .05 : .13) + (park > .62 ? .55 : 0); if (r > 4500) p *= .6;
    if (rnd() > p) continue;
    const s = 3.5 + rnd() * 2.5, th = 4 + rnd() * 3, a = rnd() * 3;
    push(x, y, 0, a, .8, 1.6, .8, 2, hex3('#5a4030'), 0);
    push(x, y, 1.4, a, s, th, s, 1, pick(TREE), Math.floor(rnd() * 997));
    occ[i] = 1; nt++;
  }
  return { data: new Float32Array(inst), buildings: nb, trees: nt };
}

// wiata przy każdym słupku: dach, szklana ściana od strony chodnika i znak przystanku; z daleka większa
function buildStops(scale) {
  const inst = [], P = {}, stations = new Set();
  D.stops.forEach(([x, y, name], m) => {
    if (!stopOn(m)) return;
    if (stopIsRail(m)) {                        // stacja kolejowa: jeden peron z wiatą i niebieską tablicą na stację
      const g = S.stopGroup[m]; if (stations.has(g)) return; stations.add(g);
      const on = S.patByStop[m] && S.patByStop[m][0]; let a = 0;
      if (on) { const pat = D.patterns[on[0]]; pointAt(S.shapes[pat[0]], pat[2][on[1]], P); a = Math.atan2(P.dy, P.dx); }
      const tx = Math.cos(a), ty = Math.sin(a), ax = ty, ay = -tx, s = scale, base = bridgeAt(x, y, tx, ty);
      const box = (u, v, b, l, h, w, c) => inst.push(x + (tx * u + ax * v) * s, base + b * s, -(y + (ty * u + ay * v) * s), a, l * s, h * s, w * s, 3, c[0], c[1], c[2], 0);
      box(0, 5, 0, 30, 1, 4, [.72, .7, .66]);                // peron obok toru
      box(0, 5.6, 3.4, 12, .35, 2.6, [.3, .36, .45]);        // wiata
      for (const u of [-5, 0, 5]) box(u, 6.5, 1, .25, 2.4, .25, [.4, .4, .42]);
      box(8, 6.6, 1, .2, 3.4, .2, [.5, .5, .52]);            // słupek tablicy
      box(8, 6.6, 3.6, 3.2, 1.1, .2, [.12, .3, .62]);        // tablica z nazwą stacji: biało-niebieska
      box(8, 6.6, 3.45, 3.4, .15, .22, [.95, .95, .95]);
      return;
    }
    let tx, ty, ax = 0, ay = 0;
    const on = S.patByStop[m] && S.patByStop[m][0];
    if (on) {                                   // kierunek jezdni i strona chodnika z trasy, która tu staje
      const pat = D.patterns[on[0]]; pointAt(S.shapes[pat[0]], pat[2][on[1]], P); tx = P.dx; ty = P.dy;
      const side = (x - P.x) * ty - (y - P.y) * tx; ax = side >= 0 ? ty : -ty; ay = side >= 0 ? -tx : tx;
    } else { const i = cellAt(x, y), a = i >= 0 ? gridAng[i] : 0; tx = Math.cos(a); ty = Math.sin(a); }
    const a = Math.atan2(ty, tx), s = scale, base = bridgeAt(x, y, tx, ty);
    const box = (u, v, b, l, h, w, c) => inst.push(x + (tx * u + ax * v) * s, base + b * s, -(y + (ty * u + ay * v) * s), a, l * s, h * s, w * s, 3, c[0], c[1], c[2], 0);
    box(0, .7, 2.6, 4.8, .3, 2.2, [.86, .87, .88]);         // dach
    box(0, 1.6, 0, 4.6, 2.6, .18, [.45, .63, .8]);         // szklana tylna ściana
    box(-2.2, .7, 0, .18, 2.6, 2.2, [.45, .63, .8]);       // ściana boczna
    box(3, .2, 0, .25, 3.4, .25, [.5, .5, .52]);           // słupek
    box(3, .2, 2.6, 1.1, .9, .15, [.98, .82, .18]);        // tablica: żółta z zielonym pasem
    box(3, .2, 2.4, 1.1, .25, .16, [.2, .6, .3]);
  });
  return new Float32Array(inst);
}
// skala wiaty: na ekranie ok. 25 px szerokości (z limitem), większa od kropki na dachu, która niesie podpis
const stopScaleFor = half => Math.min(8, Math.max(1.6, Math.round(half * .024) / 2));
const stopRoofY = half => 3 * stopScaleFor(half) + .3;
let stopScale = 0;
function syncStops() {                          // przebudowa tylko przy zmianie skali
  const sc = stopScaleFor(cam.half);
  if (sc === stopScale) return; stopScale = sc;
  if (stopBox) { gl.deleteVertexArray(stopBox.vao); gl.deleteBuffer(stopBox.buf); }
  stopBox = boxVAO(buildStops(sc), false);
}


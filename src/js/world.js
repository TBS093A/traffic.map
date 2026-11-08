/* ======================= ŚWIAT Z OSM ======================= */
// Kafle: rysujemy tylko te w kadrze. W kaflu instancje idą od największych, więc przy oddaleniu wystarczy początek listy.
const TILE = 1500, LOD_AREA = [60, 300], LOD_TREE = [.7, .92];
let WORLD = null;
const lodLevel = () => cam.half < 1000 ? 0 : cam.half < 2600 ? 1 : 2;
const tileKey = (x, y) => Math.floor(x / TILE) * 65536 + Math.floor(y / TILE);
function undelta(a) { const o = new Float64Array(a.length); let x = 0, y = 0; for (let i = 0; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; o[i] = x / 2; o[i + 1] = y / 2; } return o; }
function ringArea(r) { let a = 0; const n = r.length; for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a / 2; }
function lineOf(a) { const pts = undelta(a), cum = [0]; for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1])); return { pts, cum }; }

function tileRange(x, y) { const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE); return { x0: tx * TILE, x1: (tx + 1) * TILE, z0: -(ty + 1) * TILE, z1: -ty * TILE }; }
function tileInstances(rows, lods) { // rows: [x, y, rozmiar, 12 liczb instancji]
  const byTile = new Map();
  for (const r of rows) { const k = tileKey(r[0], r[1]); let t = byTile.get(k); if (!t) byTile.set(k, t = { r: tileRange(r[0], r[1]), rows: [] }); t.rows.push(r); }
  const data = new Float32Array(rows.length * 12), tiles = []; let o = 0;
  for (const t of byTile.values()) {
    t.rows.sort((a, b) => b[2] - a[2]);
    const off = o, lod = [t.rows.length, 0, 0];
    for (const r of t.rows) { data.set(r[3], o * 12); o++; if (r[2] >= lods[0]) lod[1]++; if (r[2] >= lods[1]) lod[2]++; }
    tiles.push({ ...t.r, off, lod });
  }
  return { ...boxVAO(data, false), tiles };
}
function viewBounds() {
  const m = 250, c = [[0, 0], [innerWidth, 0], [0, innerHeight], [innerWidth, innerHeight]].map(p => screenToGround(p[0], p[1]));
  return { x0: Math.min(...c.map(p => p[0])) - m, x1: Math.max(...c.map(p => p[0])) + m, z0: Math.min(...c.map(p => p[1])) - m, z1: Math.max(...c.map(p => p[1])) + m };
}
const tileVisible = (t, v) => t.x1 >= v.x0 && t.x0 <= v.x1 && t.z1 >= v.z0 && t.z0 <= v.z1;
function drawTiles(set, level, v) {
  gl.bindVertexArray(set.vao); gl.bindBuffer(gl.ARRAY_BUFFER, set.buf);
  for (const t of set.tiles) {
    const n = t.lod[level]; if (!n || !tileVisible(t, v)) continue;
    for (let i = 0; i < 3; i++) gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, 48, t.off * 48 + i * 16);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, n);
  }
}

const important = (h, k) => h >= 25 || k >= 9;   // wieżowce i obiekty specjalne widać z każdej odległości
function buildWorld() {
  const M = D.map, rnd = mulberry(20261107), TREE = ['#2f5a33','#3b6d38','#46803f','#557f3a','#2c4f30'].map(hex3);
  const WALLS = { 7: ['#e8e0cc','#d9c9a8','#f0ead8','#cdbfa5','#e0d4bc'], 0: ['#e6e2d8','#d6d2c8','#cfd6dc','#e3d9c0','#c9cfc2','#dccfb5'], 8: ['#b8bcc0','#a9adb2','#c3c1b8'],
    9: ['#d6d2c8'], 10: ['#3f6f9e'], 11: ['#f0ead8','#e8dcc4','#a8503a','#e3d5b8'], 12: ['#9e9a94'] };
  for (const k in WALLS) WALLS[k] = WALLS[k].map(hex3);
  const wallOf = (k, seed) => WALLS[k][seed % WALLS[k].length];

  // budynki prostokątne: obrócone prostopadłościany
  const b = M.b, rows = new Array(b.x.length); let x = 0, y = 0;
  for (let i = 0; i < b.x.length; i++) {
    x += b.x[i]; y += b.y[i];
    const X = x / 2, Y = y / 2, l = b.l[i] / 2, w = b.w[i] / 2, h = b.h[i] / 2, k = b.k[i], seed = Math.abs(x * 31 + y) % 997, c = wallOf(k, seed);
    rows[i] = [X, Y, important(h, k) ? 1e9 : l * w, [X, 0, -Y, b.a[i] / 2 * Math.PI / 180, l, h, w, k, c[0], c[1], c[2], seed]];
  }
  // mosty: pomost z podjazdami nad terenem, filary co 25 m; kładki krótsze niż 15 m zostają płaskie
  const ROAD_HW = [8, 5.5, 3.8, 2.4, 2.6], flatBridges = [[], [], [], [], []], decks = [[], [], [], [], []], PB = {};
  for (const [bk, layer, enc] of M.rb || []) {
    const ln = lineOf(enc), L = ln.cum[ln.cum.length - 1];
    if (L < 15) { flatBridges[bk].push(enc); continue; }
    const H = 5 * layer, ramp = Math.min(30, L * .35);
    const deck = densify(ln, 4, (x, y, dx, dy, d) => H * clamp(Math.min(d, L - d) / ramp, 0, 1));
    decks[bk].push(deck);
    for (let i = 0; i < deck.cum.length; i++) {
      const j = Math.min(i + 1, deck.cum.length - 1), i0 = j === i ? i - 1 : i, dl = deck.cum[j] - deck.cum[i0] || 1;
      const dx = (deck.pts[2 * j] - deck.pts[2 * i0]) / dl, dy = (deck.pts[2 * j + 1] - deck.pts[2 * i0 + 1]) / dl;
      for (let o = -ROAD_HW[bk]; o <= ROAD_HW[bk]; o += 2) {     // cały przekrój pomostu
        const x = deck.pts[2 * i] + dy * o, y = deck.pts[2 * i + 1] - dx * o, k = bridgeKey(x, y), c = bridgeGrid.get(k);
        if (!c || c[0] < deck.h[i]) bridgeGrid.set(k, [deck.h[i], dx, dy]);
      }
    }
    for (let i = 0; i + 1 < deck.cum.length; i++) {               // dźwigar: betonowy bok pomostu
      const ax = deck.pts[2 * i], ay = deck.pts[2 * i + 1], bx = deck.pts[2 * i + 2], by = deck.pts[2 * i + 3], h = (deck.h[i] + deck.h[i + 1]) / 2;
      if (h < 2) continue;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      rows.push([mx, my, 1e3, [mx, h - 1.8, -my, Math.atan2(by - ay, bx - ax), Math.hypot(bx - ax, by - ay) + .4, 1.8, ROAD_HW[bk] * 2 + .6, 8, .66, .65, .62, 0]]);
    }
    for (let d = ramp + 8; d <= L - ramp - 8; d += 25) {
      pointAt(deck, d, PB); const h = H - .3;
      rows.push([PB.x, PB.y, 1e3, [PB.x, 0, -PB.y, Math.atan2(PB.dy, PB.dx), 1.6, h, ROAD_HW[bk] * 1.3, 8, .6, .6, .58, 0]]);
    }
  }
  const boxes = tileInstances(rows, LOD_AREA);

  // budynki o złożonym obrysie: ściany i dach z prawdziwego kształtu
  const polys = M.p.map(([h, k, ...rs]) => {
    const rings = rs.map(undelta), lenO = rings[0].length; let area = ringArea(rings[0]);
    for (let i = 1; i < rings.length; i++) area += ringArea(rings[i]);
    return { h: h / 2, k, rings, area, rank: important(h / 2, k) ? 1e9 : area, x: rings[0][0], y: rings[0][1], lenO };
  });
  let nV = 0, nI = 0;
  for (const P of polys) {
    const flat = new Float64Array(P.rings.reduce((a, r) => a + r.length, 0)), holes = []; let o = 0;
    P.rings.forEach((r, i) => { if (i) holes.push(o / 2); flat.set(r, o); o += r.length; });
    P.flat = flat; P.tris = earcut(flat, holes, 2); nV += flat.length * 2 + flat.length / 2; nI += flat.length * 3 + P.tris.length;
  }
  const buf = new ArrayBuffer(nV * 28), f32 = new Float32Array(buf), i8 = new Int8Array(buf), u16 = new Uint16Array(buf), u8 = new Uint8Array(buf), idx = new Uint32Array(nI);
  let v = 0, ii = 0; const meshTiles = new Map();
  const vert = (px, py, pz, nx, ny, nz, u, W, H, k, seed, c) => {
    const b4 = v * 7, by = v * 28;
    f32[b4] = px; f32[b4 + 1] = py; f32[b4 + 2] = pz;
    i8[by + 12] = nx * 127; i8[by + 13] = ny * 127; i8[by + 14] = nz * 127;
    u16[by / 2 + 8] = u * 10; u16[by / 2 + 9] = W * 10; u16[by / 2 + 10] = H * 10;
    u8[by + 22] = k; u8[by + 23] = seed; u8[by + 24] = c[0] * 255; u8[by + 25] = c[1] * 255; u8[by + 26] = c[2] * 255;
    return v++;
  };
  for (const P of polys) { const k = tileKey(P.x, P.y); let t = meshTiles.get(k); if (!t) meshTiles.set(k, t = { ...tileRange(P.x, P.y), list: [] }); t.list.push(P); }
  const tilesM = [];
  for (const t of meshTiles.values()) {
    t.list.sort((a, b) => b.rank - a.rank);
    const off = ii, lod = [0, 0, 0];
    for (const P of t.list) {
      const seed = Math.abs(Math.round(P.x * 62 + P.y * 2)) % 251, c = wallOf(P.k, seed), { h, k } = P;
      for (const r of P.rings) for (let i = 0, n = r.length; i < n; i += 2) {
        const j = (i + 2) % n, ax = r[i], ay = r[i + 1], bx = r[j], by = r[j + 1], L = Math.hypot(bx - ax, by - ay) || 1, nx = (by - ay) / L, nz = (bx - ax) / L;
        const a = vert(ax, 0, -ay, nx, 0, nz, 0, L, h, k, seed, c), e = vert(bx, 0, -by, nx, 0, nz, L, L, h, k, seed, c), g = vert(bx, h, -by, nx, 0, nz, L, L, h, k, seed, c), d = vert(ax, h, -ay, nx, 0, nz, 0, L, h, k, seed, c);
        idx[ii++] = a; idx[ii++] = e; idx[ii++] = g; idx[ii++] = a; idx[ii++] = g; idx[ii++] = d;
      }
      const base = v, fl = P.flat;
      for (let i = 0; i < fl.length; i += 2) vert(fl[i], h, -fl[i + 1], 0, 1, 0, 0, 0, h, k, seed, c);
      for (const t3 of P.tris) idx[ii++] = base + t3;
      const cnt = ii - off; lod[0] = cnt; if (P.rank >= LOD_AREA[0]) lod[1] = cnt; if (P.rank >= LOD_AREA[1]) lod[2] = cnt;
    }
    tilesM.push({ x0: t.x0, x1: t.x1, z0: t.z0, z1: t.z1, off, lod });
  }
  const meshVao = gl.createVertexArray(); gl.bindVertexArray(meshVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 28, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.UNSIGNED_SHORT, false, 28, 16);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.UNSIGNED_BYTE, false, 28, 22);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 3, gl.UNSIGNED_BYTE, true, 28, 24);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  // teren: wielokąty w kolejności klas (woda na końcu), drzewa w lasach
  const forest = M.classes.indexOf('forest'), land = []; let nT = 0, forestArea = 0;
  for (const [cls, ...rs] of M.l) {
    const rings = rs.map(undelta), flat = new Float64Array(rings.reduce((a, r) => a + r.length, 0)), holes = []; let o = 0;
    rings.forEach((r, i) => { if (i) holes.push(o / 2); flat.set(r, o); o += r.length; });
    const tris = earcut(flat, holes, 2); nT += tris.length; land.push({ cls, flat, tris, seed: Math.abs(Math.round(flat[0] + flat[1])) % 997 });
    if (cls === forest) forestArea += ringArea(rings[0]);
  }
  const landData = new Float32Array(nT * 4), treeRows = [], perM2 = Math.min(1 / 600, 150000 / Math.max(forestArea, 1));
  let lo = 0;
  const crown = (X, Y, base, s, th) => treeRows.push([X, Y, rnd(), [X, base, -Y, rnd() * 3, s, th, s, 1, ...TREE[Math.floor(rnd() * TREE.length)], Math.floor(rnd() * 997)]]);
  for (const { cls, flat, tris, seed } of land) {
    for (const t of tris) { landData[lo++] = flat[2 * t]; landData[lo++] = -flat[2 * t + 1]; landData[lo++] = cls; landData[lo++] = seed; }
    if (cls !== forest) continue;
    for (let i = 0; i < tris.length; i += 3) {
      const ax = flat[2 * tris[i]], ay = flat[2 * tris[i] + 1], bx = flat[2 * tris[i + 1]], by = flat[2 * tris[i + 1] + 1], cx = flat[2 * tris[i + 2]], cy = flat[2 * tris[i + 2] + 1];
      const want = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2 * perM2;
      for (let n = Math.floor(want) + (rnd() < want % 1 ? 1 : 0); n > 0; n--) {
        let u = rnd(), w = rnd(); if (u + w > 1) { u = 1 - u; w = 1 - w; }
        crown(ax + (bx - ax) * u + (cx - ax) * w, ay + (by - ay) * u + (cy - ay) * w, 0, 5 + rnd() * 3, 8 + rnd() * 6);
      }
    }
  }
  const tr = undelta(M.t);
  for (let i = 0; i < tr.length; i += 2) {
    const X = tr[i], Y = tr[i + 1], r = rnd();
    treeRows.push([X, Y, r, [X, 0, -Y, 0, .8, 1.6, .8, 2, .35, .25, .19, 0]]);
    crown(X, Y, 1.4, 3.5 + r * 2.5, 4 + r * 3);
  }

  const lineVao = (lines, hw, px, maxHalf, mode) => {
    const g = stripLines(lines.map(l => l.h ? l : lineOf(l))), { vao } = vaoFrom(g, STRIP);
    return { vao, count: g.length / 7, hw, px, maxHalf, mode };
  };
  const landVao = vaoFrom(landData, [[0, 2, 4, 0], [1, 2, 4, 2]]);
  const counts = { buildings: b.x.length + M.p.length, trees: treeRows.length - tr.length / 2 };
  WORLD = { counts, boxes, trees: tileInstances(treeRows, LOD_TREE), mesh: { vao: meshVao, tiles: tilesM }, land: { vao: landVao.vao, count: nT },
    waterLines: [lineVao(M.w[1], 1.2, .5, 2600, 4), lineVao(M.w[0], 5, .9, 1e9, 4)],
    roads: [lineVao(M.r[3].concat(flatBridges[3]), 2.4, 0, 1400, 0), lineVao(M.r[2].concat(flatBridges[2]), 3.8, .6, 3600, 0), lineVao(M.r[4].concat(flatBridges[4]), 2.6, .7, 1e9, 3),
      lineVao(M.r[1].concat(flatBridges[1]), 5.5, .8, 1e9, 0), lineVao(M.r[0].concat(flatBridges[0]), 8, 1, 1e9, 0)],
    bridges: [[3, 2.4, 0, 1400, 0], [2, 3.8, .6, 3600, 0], [4, 2.6, .7, 1e9, 3], [1, 5.5, .8, 1e9, 0], [0, 8, 1, 1e9, 0]].filter(([bk]) => decks[bk].length).map(([bk, ...a]) => lineVao(decks[bk], ...a)) };
  delete D.map;
}
function drawMesh(level, v) {
  gl.bindVertexArray(WORLD.mesh.vao);
  for (const t of WORLD.mesh.tiles) { const n = t.lod[level]; if (n && tileVisible(t, v)) gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_INT, t.off * 4); }
}


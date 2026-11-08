/* ======================= RZEŹBA TERENU ======================= */
// Siatka wysokości (D.dem, z pipeline'u) trafia do tekstury na jednostce 5. Wysokość dodają vertex shadery
// (demAt w COMMON), więc geometria budynków, dróg i autobusów zostaje płaska w danych.
// W JS ta sama interpolacja służy do rzutowania ekran <-> świat (klikanie, podpisy, kadrowanie).
const TERR = { on: false, h: null, x0: 0, y0: 0, dx: 1, dy: 1, nx: 1, ny: 1, tex: null };
const DEM_UNIT = 5;
const terrK = () => TERR.on ? (opt.relief || 0) : 0;

function setupTerrain() {
  const d = D.dem;
  TERR.tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + DEM_UNIT); gl.bindTexture(gl.TEXTURE_2D, TERR.tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if (d && d.h && d.h.length === d.nx * d.ny) {
    Object.assign(TERR, { on: true, x0: d.x0, y0: d.y0, dx: d.dx, dy: d.dy, nx: d.nx, ny: d.ny, h: Float32Array.from(d.h, v => v / 10) });
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, d.nx, d.ny, 0, gl.RED, gl.FLOAT, TERR.h);
  } else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);
}
// wysokość terenu [m] w punkcie (x wschód, y północ), z przewyższeniem z ustawień
function demH(x, y) {
  const k = terrK(); if (!k) return 0;
  const gx = clamp((x - TERR.x0) / TERR.dx, 0, TERR.nx - 1), gy = clamp((y - TERR.y0) / TERR.dy, 0, TERR.ny - 1);
  const i = Math.min(Math.floor(gx), TERR.nx - 2), j = Math.min(Math.floor(gy), TERR.ny - 2), u = gx - i, v = gy - j, H = TERR.h, n = TERR.nx;
  return ((H[j * n + i] * (1 - u) + H[j * n + i + 1] * u) * (1 - v) + (H[(j + 1) * n + i] * (1 - u) + H[(j + 1) * n + i + 1] * u) * v) * k;
}
// uniformy terenu dla programu (każdy, który dołącza DEM_GLSL)
function setDem(P) {
  if (!P.u.uDemK) return;
  gl.uniform1i(P.u.uDem, DEM_UNIT); gl.uniform1f(P.u.uDemK, terrK());
  gl.uniform4f(P.u.uDemBox, TERR.x0, TERR.y0, TERR.dx, TERR.dy); gl.uniform2f(P.u.uDemN, TERR.nx, TERR.ny);
}
// grunt: siatka gęsta nad danymi wysokości i rzadka dookoła (do 40 km), żeby horyzont nie miał dziur
function groundGeo() {
  const E = 40000;
  if (!TERR.on) return { data: new Float32Array([-E, -E, E, -E, E, E, -E, -E, E, E, -E, E]), idx: null };
  const axis = (a0, d, n, sign) => {           // linie siatki: co krok DEM w obszarze danych, co 2 km poza nim
    const inner = []; for (let i = 0; i < n; i++) inner.push(sign * (a0 + d * i));
    inner.sort((a, b) => a - b);
    const out = [-E]; for (let v = -E + 2000; v < inner[0]; v += 2000) out.push(v);
    out.push(...inner); for (let v = Math.ceil(inner[inner.length - 1] / 2000) * 2000; v < E; v += 2000) if (v > inner[inner.length - 1]) out.push(v);
    out.push(E); return out;
  };
  const xs = axis(TERR.x0, TERR.dx, TERR.nx, 1), zs = axis(TERR.y0, TERR.dy, TERR.ny, -1);   // z = -północ
  const data = new Float32Array(xs.length * zs.length * 2); let o = 0;
  for (const z of zs) for (const x of xs) { data[o++] = x; data[o++] = z; }
  const W = xs.length, idx = new Uint32Array((xs.length - 1) * (zs.length - 1) * 6); o = 0;
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < W - 1; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx[o++] = a; idx[o++] = b; idx[o++] = d; idx[o++] = a; idx[o++] = d; idx[o++] = c;
  }
  return { data, idx };
}
function groundVAO() {
  const g = groundGeo(), v = vaoFrom(g.data, [[0, 2, 2, 0]]);
  if (!g.idx) return { ...v, count: 6, indexed: false };
  gl.bindVertexArray(v.vao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.STATIC_DRAW); gl.bindVertexArray(null);
  return { ...v, count: g.idx.length, indexed: true };
}
// trójkąty terenu z OSM dzielone, aż najdłuższy bok jest krótszy niż max (żeby szły za rzeźbą terenu)
function subdivideTris(out, ax, ay, bx, by, cx, cy, max, depth = 0) {
  const ab = Math.hypot(bx - ax, by - ay), bc = Math.hypot(cx - bx, cy - by), ca = Math.hypot(ax - cx, ay - cy), L = Math.max(ab, bc, ca);
  if (L <= max || depth >= 6) { out.push(ax, ay, bx, by, cx, cy); return; }
  if (L === ab) { const mx = (ax + bx) / 2, my = (ay + by) / 2; subdivideTris(out, ax, ay, mx, my, cx, cy, max, depth + 1); subdivideTris(out, mx, my, bx, by, cx, cy, max, depth + 1); }
  else if (L === bc) { const mx = (bx + cx) / 2, my = (by + cy) / 2; subdivideTris(out, ax, ay, bx, by, mx, my, max, depth + 1); subdivideTris(out, ax, ay, mx, my, cx, cy, max, depth + 1); }
  else { const mx = (cx + ax) / 2, my = (cy + ay) / 2; subdivideTris(out, ax, ay, bx, by, mx, my, max, depth + 1); subdivideTris(out, mx, my, bx, by, cx, cy, max, depth + 1); }
}
// linie (drogi, rzeki) zagęszczone, żeby nie przecinały wzniesień na skróty
const terrainLine = L => TERR.on && L.cum.length > 1 && !L.h ? densify(L, 60, () => 0) : L;

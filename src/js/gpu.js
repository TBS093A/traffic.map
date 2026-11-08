const R = { fbo: null, low: [0, 0], vaos: {} };
function makeTex(w, h, ifmt, fmt, type) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = Math.floor(innerWidth * dpr), H = Math.floor(innerHeight * dpr);
  const ps = Math.max(1, Math.round((opt.ps + perfPixel()) * dpr));
  const lw = Math.ceil(W / ps), lh = Math.ceil(H / ps);
  if (canvas.width === W && canvas.height === H && R.low[0] === lw && R.low[1] === lh && R.ps === ps) return;
  canvas.width = W; canvas.height = H; R.ps = ps; R.dpr = dpr;
  if (R.fbo) { gl.deleteFramebuffer(R.fbo); R.texs.forEach(t => gl.deleteTexture(t)); }
  R.low = [lw, lh];
  const tc = makeTex(lw, lh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE), tn = makeTex(lw, lh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE), td = makeTex(lw, lh, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
  R.texs = [tc, tn, td];
  R.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, R.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tc, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tn, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, td, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function vaoFrom(data, layout) { // layout: [[loc,size,stride,offset,divisor,buffer?]]
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (const [loc, size, stride, off] of layout) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, off * 4); }
  gl.bindVertexArray(null); return { vao, buf };
}
function boxVAO(instData, dynamic, geo = R.cubeBuf, verts = 36) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, geo);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, instData, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(2 + i); gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, 48, i * 16); gl.vertexAttribDivisor(2 + i, 1); }
  gl.bindVertexArray(null); return { vao, buf: ib, count: instData.length / 12, verts };
}

// pas drogi z listy tras: [x, z, offset x, offset z (w jednostkach pół-szerokości), poprzecznie, wzdłuż]
// pas: [x, z, offset x, offset z, poprzecznie, wzdłuż, wysokość nad gruntem]
const STRIP = [[0, 4, 7, 0], [1, 2, 7, 4], [2, 1, 7, 6]];
function stripGeo(shapeIdxs) { return stripLines(shapeIdxs.map(s => onBridges(S.shapes[s]))); }
function stripLines(lines) {
  let segs = 0; for (const l of lines) segs += l.cum.length - 1;
  const out = new Float32Array(segs * 6 * 7); let o = 0;
  for (const { pts, cum, h } of lines) {
    for (let i = 0; i < cum.length - 1; i++) {
      const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * i + 2], by = pts[2 * i + 3];
      const L = Math.hypot(bx - ax, by - ay) || 1, dx = (bx - ax) / L, dy = (by - ay) / L, e = .9;
      const A = [ax, ay, -dx * e, -dy * e, cum[i], h ? h[i] : 0], B = [bx, by, dx * e, dy * e, cum[i + 1], h ? h[i + 1] : 0];
      const V = [[A, 1], [A, -1], [B, -1], [A, 1], [B, -1], [B, 1]];
      for (const [P, side] of V) {
        out[o++] = P[0]; out[o++] = -P[1];
        out[o++] = P[2] - dy * side; out[o++] = -(P[3] + dx * side);
        out[o++] = side; out[o++] = P[4]; out[o++] = P[5];
      }
    }
  }
  return out;
}
// linia zagęszczona co ≤ step m, z wysokością w każdym punkcie: hAt(x, y, dx, dy, d)
function densify({ pts, cum }, step, hAt) {
  const P = [], C = [], H = [], n = cum.length;
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * i + 2], by = pts[2 * i + 3], L = cum[i + 1] - cum[i] || 1, k = Math.max(1, Math.ceil(L / step));
    for (let j = 0; j < k; j++) { const f = j / k, x = ax + (bx - ax) * f, y = ay + (by - ay) * f; P.push(x, y); C.push(cum[i] + L * f); H.push(hAt(x, y, (bx - ax) / L, (by - ay) / L, cum[i] + L * f)); }
  }
  const x = pts[2 * n - 2], y = pts[2 * n - 1], L = (cum[n - 1] - cum[n - 2]) || 1;
  P.push(x, y); C.push(cum[n - 1]); H.push(hAt(x, y, (x - pts[2 * n - 4]) / L, (y - pts[2 * n - 3]) / L, cum[n - 1]));
  return { pts: P, cum: C, h: H, len: cum[n - 1] };
}
// mosty: siatka 4 m z wysokością pomostu i jego kierunkiem, żeby autobus pod wiaduktem nie wskoczył na górę
const BRIDGE_CELL = 4, bridgeGrid = new Map();
const bridgeKey = (x, y) => Math.floor(x / BRIDGE_CELL) * 100003 + Math.floor(y / BRIDGE_CELL);
function bridgeAt(x, y, dx, dy) {
  const c = bridgeGrid.get(bridgeKey(x, y)); if (!c) return 0;
  return Math.abs(c[1] * dx + c[2] * dy) > .85 ? c[0] : 0;
}
function onBridges(line) {
  if (line.cum.length < 2) return line;
  if (!bridgeGrid.size) return terrainLine(line);
  return densify(line, 4, (x, y, dx, dy) => bridgeAt(x, y, dx, dy));
}


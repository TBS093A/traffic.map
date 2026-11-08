/* ======================= PODPISY 3D: ULICE I PRZYSTANKI ======================= */
// Tekst jest prawdziwym meshem w świecie 3D: płaskie czworokąty glifów ułożone wzdłuż ulicy,
// unoszące się nad zabudową. Proporcje są korygowane o skrót perspektywy kamery, więc napis
// czyta się normalnie z każdej z 4 stron. Gdy coś go zasłania, napis się przyciemnia.
const LBL = { tex: null, g: new Map(), cellH: 64, fontPx: 44, pad: 10, vao: null, buf: null, count: 0, key: '', cap: 0,
  streetH: 22, streetPx: 16, stopPx: 15, discPx: 14 };

async function buildAtlas() {
  try { await Promise.race([document.fonts.load('600 44px "Pixelify Sans"'), new Promise(r => setTimeout(r, 2500))]); } catch (e) {}
  const chars = new Set([' ']);
  for (const [n] of D.streets || []) for (const c of n) chars.add(c);
  for (const g of S.groups) for (const c of g.name) chars.add(c);
  for (const m of D.stops.keys()) for (const c of S.side[m].plat + sideText(m)) chars.add(c);
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZĄĆĘŁŃÓŚŹŻabcdefghijklmnopqrstuvwxyząćęłńóśźż0123456789.,-/()→:!…') chars.add(c);
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  const font = `600 ${LBL.fontPx}px "Pixelify Sans", ui-monospace, monospace`, W = 2048, H = LBL.cellH, pad = LBL.pad;
  ctx.font = font;
  const items = [...chars].map(c => ({ c, adv: ctx.measureText(c).width })); items.push({ c: '\u0001', adv: H - 2 * pad, disc: true });
  let x = 0, y = 0;
  for (const it of items) { const w = Math.ceil(it.adv + 2 * pad); if (x + w > W) { x = 0; y += H; } it.x = x; it.y = y; it.w = w; x += w + 2; }
  cv.width = W; cv.height = y + H;
  ctx.font = font; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const it of items) {
    if (it.disc) {
      const cx = it.x + it.w / 2, cy = it.y + H / 2;
      ctx.beginPath(); ctx.arc(cx, cy, H / 2 - 8, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, H / 2 - 17, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    } else if (it.c !== ' ') {
      ctx.lineWidth = 12; ctx.strokeStyle = '#000'; ctx.strokeText(it.c, it.x + pad, it.y + H / 2);
      ctx.fillStyle = '#fff'; ctx.fillText(it.c, it.x + pad, it.y + H / 2);
    }
    LBL.g.set(it.c, { adv: it.adv, w: it.w, u0: it.x / W, u1: (it.x + it.w) / W, v0: it.y / cv.height, v1: (it.y + H) / cv.height });
  }
  LBL.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, LBL.tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  LBL.vao = gl.createVertexArray(); gl.bindVertexArray(LBL.vao);
  LBL.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, LBL.buf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 20);
  gl.bindVertexArray(null);
}

const labelP = prog(`#version 300 es
layout(location=0) in vec3 aP; layout(location=1) in vec2 aUV; layout(location=2) in vec4 aT;
uniform mat4 uVP; out vec2 vUV; out vec4 vT;
void main(){ vUV=aUV; vT=aT; gl_Position=uVP*vec4(aP,1.); }`,
`#version 300 es
precision highp float;
uniform sampler2D uAtlas; uniform sampler2D uD; uniform int uPs; uniform ivec2 uLow; uniform float uBias;
in vec2 vUV; in vec4 vT; out vec4 o;
void main(){
  vec4 c=texture(uAtlas,vUV);
  if(c.a<.02) discard;
  ivec2 p=clamp(ivec2(gl_FragCoord.xy)/uPs, ivec2(0), uLow-1);
  float occ = vT.a>1.5 || gl_FragCoord.z <= texelFetch(uD,p,0).r + uBias ? 1. : .3;
  o=vec4(mix(vec3(.05,.06,.1), vT.rgb, smoothstep(.2,.62,c.r)), smoothstep(.04,.45,c.a)*min(vT.a,1.)*occ);
}`);

// przystanki zaznaczonego kursu albo całej zaznaczonej linii (null, gdy nic nie zaznaczono)
const routeStopSets = new Map();
function litStops() {
  if (selTrip >= 0) return new Set(S.trips[selTrip].stops);
  if (selRoute < 0) return null;
  if (!routeStopSets.has(selRoute)) { const set = new Set(); for (const t of S.trips) if (t.route === selRoute) for (const m of t.stops) set.add(m); routeStopSets.set(selRoute, set); }
  return routeStopSets.get(selRoute);
}
function rebuildLabels() {
  const bucket = Math.round(Math.log2(cam.half) * 2), half = Math.pow(2, bucket / 2);
  const yaw = cam.yawT, se = Math.sin(cam.elev), ce = Math.cos(cam.elev), sy = Math.sin(yaw), cy = Math.cos(yaw);
  const R = [cy, -sy], A = [-sy, -cy], U = [-se * sy, ce, -se * cy];
  const wpp = 2 * half / innerHeight;                     // metry płaszczyzny widoku na 1 px CSS
  const sq = (ux, uz) => Math.max(.2, Math.hypot(ux * R[0] + uz * R[1], (ux * A[0] + uz * A[1]) * se)); // skrót perspektywy
  const view = (x, y, z) => [x * R[0] + z * R[1], x * U[0] + y * U[1] + z * U[2]];
  const out = []; const grid = new Map(); const cell = 40 * wpp; LBL.hits = [];
  const gkey = (a, b) => a * 73856093 ^ b * 19349663;
  const hits = circles => { for (const [cx, cy2, r] of circles) { const gx = Math.floor(cx / cell), gy = Math.floor(cy2 / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = grid.get(gkey(gx + i, gy + j)); if (l) for (const [x2, y2, r2] of l) if (Math.hypot(cx - x2, cy2 - y2) < r + r2) return true; } } return false; };
  const add = circles => { for (const c of circles) { const k = gkey(Math.floor(c[0] / cell), Math.floor(c[1] / cell)); const l = grid.get(k); if (l) l.push(c); else grid.set(k, [c]); } };
  const quad = (q, cx, cz, y, T, N, hw, hh, g, tint) => {
    const c = [[-1, 1, g.u0, g.v0], [1, 1, g.u1, g.v0], [1, -1, g.u1, g.v1], [-1, 1, g.u0, g.v0], [1, -1, g.u1, g.v1], [-1, -1, g.u0, g.v1]];
    for (const [a, b, u, v] of c) q.push(cx + T[0] * hw * a + N[0] * hh * b, y, cz + T[1] * hw * a + N[1] * hh * b, u, v, tint[0], tint[1], tint[2], tint[3]);
  };
  const perpAway = T => { let N = [-T[1], T[0]]; if (N[0] * A[0] + N[1] * A[1] < 0) N = [-N[0], -N[1]]; return N; };
  const selSet = new Set(); if (selStop >= 0) selSet.add(S.stopGroup[selStop]); for (const si of planStops()) selSet.add(S.stopGroup[si]);
  const isSel = id => selSet.has(id);
  const TS = [.96, .94, .88, 1], TP = [.68, .84, 1, 2], TSEL = [1, .85, .35, 2], TSG = [.96, .94, .88, 2];   // alfa 2: bez przyciemniania za zabudową

  // --- przystanki: kropki (każdy słupek); podpis na grupę, a z bliska osobno dla każdej strony ruchu
  const putText = (text, x, y, px, tint, force, yH = .6, center = false, stop = -1) => {
    const k = px / LBL.fontPx, hh = LBL.cellH * k * wpp / sq(A[0], A[1]) / 2;
    const glyphs = [...text].map(c => LBL.g.get(c) || LBL.g.get(' '));
    const wPx = glyphs.reduce((a, g) => a + g.adv, 0) * k;
    let s = center ? -wPx * wpp / 2 : (LBL.discPx + 5) * wpp;
    const s0 = s / wpp;
    const q = [], circ = [];
    for (const g of glyphs) {
      const adv = g.adv * k * wpp, cx = x + R[0] * (s + adv / 2), cz = -y + R[1] * (s + adv / 2);
      quad(q, cx, cz, yH, R, A, g.w * k * wpp / 2, hh, g, tint);
      const v = view(cx, yH, cz); circ.push([v[0], v[1], px * wpp * .55]); s += adv;
    }
    if (!force && hits(circ)) return false;
    add(circ); for (const v of q) out.push(v);
    if (stop >= 0) LBL.hits.push({ stop, x, y, yH, s0, w: wPx, h: px });   // podpis przystanku klika się jak kropka
    return true;
  };
  for (const mk of planMarkers()) {
    const g = LBL.g.get('\u0001'), r = 9 * wpp;
    quad(out, mk.x, -mk.y, .7, R, A, r / sq(R[0], R[1]), r / sq(A[0], A[1]), g, mk.tint);
    putText(mk.text, mk.x, mk.y, 15, mk.tint, true, .7);
  }
  {                                             // kropki przystanków widać z każdej odległości, z daleka mniejsze
    const roof = stopRoofY(cam.half), g = LBL.g.get('\u0001');
    const dpx = LBL.discPx * (half < 300 ? 1.3 : cam.half > 2600 ? .45 : cam.half > 1500 ? .65 : 1);
    const selG = selStop >= 0 ? S.stopGroup[selStop] : -1;
    const lit = litStops();                     // przystanki zaznaczonego autobusu / linii: reszta przygaszona
    const TDIM = [.45, .72, 1, .22], TDOT = [.45, .72, 1, 2];
    for (const grp of S.groups) {
      for (const m of grp.members) {
        const [x, y] = D.stops[m], sel = isSel(grp.id) && (grp.id !== selG || selSide < 0 || selSide === m);
        const on = lit && lit.has(m), k = sel ? 1.8 : on ? Math.max(1, .9 / (dpx / LBL.discPx)) : lit ? .7 : 1;
        quad(out, x, -y, roof, R, A, dpx * k * wpp / sq(R[0], R[1]), dpx * k * wpp / sq(A[0], A[1]), g, sel ? TSEL : lit && !on ? TDIM : TDOT);
      }
    }
    let n = 0;
    if (lit) {                                  // podpisy tylko przystanków zaznaczonego kursu, przy każdym zoomie
      for (const grp of S.groups) {
        const m = grp.members.find(mm => lit.has(mm)); if (m === undefined) continue;
        putText(grp.name, D.stops[m][0], D.stops[m][1], LBL.stopPx, isSel(grp.id) ? TSEL : TP, isSel(grp.id), roof, false, m);
      }
    }
    const order = [...S.groups].sort((a, b) => isSel(b.id) - isSel(a.id) || b.trips - a.trips);
    const close = cam.half < 230;
    for (const grp of order) {
      const sel = isSel(grp.id);
      if (lit && !sel) continue;
      if (!(cam.half < 520 || sel)) break;
      if (n > 300) break;
      if ((close || (sel && cam.half < 700)) && grp.members.length > 1) {   // z bliska: nazwa grupy, pod nią każda strona ruchu
        putText(grp.name, grp.x, grp.y, LBL.stopPx + 1, sel ? TSEL : TSG, sel, roof + 6, true, grp.members[0]);
        for (const m of grp.members) {
          const sd = S.side[m], t = (sd.plat ? sd.plat + ' ' : '') + (sd.arrOnly ? 'wysiadka' : '→ ' + (sd.heads[0] || ''));
          const on = sel && (grp.id !== selG || selSide < 0 || selSide === m);
          if (putText(t.length > 30 ? t.slice(0, 29) + '…' : t, D.stops[m][0], D.stops[m][1], LBL.stopPx - 1, on ? TSEL : TP, sel, roof, false, m)) n++;
        }
      } else if (putText(grp.name, grp.x, grp.y, LBL.stopPx, sel ? TSEL : TP, sel, roof, false, grp.members[0])) n++;
    }
  }

  // --- ulice: tekst wzdłuż trasy, nad zabudową (przy oddaleniu zostają tylko te, które się mieszczą)
  {
    const k = LBL.streetPx / LBL.fontPx, P = {}, Hs = LBL.streetH;
    const tanAt = (sh, d, span) => { pointAt(sh, d - span, P); const ax = P.x, ay = P.y; pointAt(sh, d + span, P); const dx = P.x - ax, dy = P.y - ay, L = Math.hypot(dx, dy) || 1; return [dx / L, -dy / L]; };
    for (const [name, runs] of D.streets || []) {
      const glyphs = [...name].map(c => LBL.g.get(c) || LBL.g.get(' '));
      const pxW = glyphs.reduce((a, g) => a + g.adv, 0) * k;
      const centers = [];
      for (const [si, d0, d1] of runs) {
        const sh = S.shapes[si], L = d1 - d0; if (L <= 0) continue;
        const Tm = tanAt(sh, (d0 + d1) / 2, 15), textLen = pxW * wpp / sq(Tm[0], Tm[1]);
        if (textLen * 1.15 > L) continue;
        const cands = [(d0 + d1) / 2];
        for (let d = d0 + textLen; d < d1 - textLen && L > 3.2 * textLen; d += 2.6 * textLen) cands.push(d);
        for (const dc of cands) {
          pointAt(sh, dc, P); const px = P.x, py = P.y;
          if (centers.some(([x, y]) => Math.hypot(x - px, y - py) < Math.max(5 * textLen, 250))) continue;
          const t0 = tanAt(sh, dc - textLen / 2, 8), t1 = tanAt(sh, dc + textLen / 2, 8), t2 = tanAt(sh, dc, 8);
          if (t0[0] * t2[0] + t0[1] * t2[1] < .8 || t1[0] * t2[0] + t1[1] * t2[1] < .8) continue;  // za kręto
          const dir = (t2[0] * R[0] + t2[1] * R[1]) < 0 ? -1 : 1;
          let s = dc - dir * textLen / 2; const q = [], circ = [];
          for (const g of glyphs) {
            let T = tanAt(sh, s, Math.max(6, textLen / glyphs.length)); T = [T[0] * dir, T[1] * dir];
            const f = sq(T[0], T[1]), adv = g.adv * k * wpp / f;
            const sc = s + dir * adv / 2; pointAt(sh, sc, P);
            T = tanAt(sh, sc, Math.max(6, textLen / glyphs.length)); T = [T[0] * dir, T[1] * dir];
            const N = perpAway(T);
            quad(q, P.x, -P.y, Hs, T, N, g.w * k * wpp / sq(T[0], T[1]) / 2, LBL.cellH * k * wpp / sq(N[0], N[1]) / 2, g, TS);
            const v = view(P.x, Hs, -P.y); circ.push([v[0], v[1], LBL.streetPx * wpp * .6]);
            s += dir * adv;
          }
          if (hits(circ)) continue;
          add(circ); for (const v of q) out.push(v); centers.push([px, py]);
        }
      }
    }
  }

  const data = new Float32Array(out);
  gl.bindBuffer(gl.ARRAY_BUFFER, LBL.buf);
  if (data.length > LBL.cap) { LBL.cap = Math.ceil(data.length * 1.5); gl.bufferData(gl.ARRAY_BUFFER, LBL.cap * 4, gl.DYNAMIC_DRAW); }
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  LBL.count = data.length / 9;
}

function drawLabels() {
  if (!LBL.tex) return;
  const key = Math.round(Math.log2(cam.half) * 2) + '|' + selTrip + '|' + selRoute + '|' + Math.round(cam.yawT / (Math.PI / 2)) + '|' + (selStop >= 0 ? S.stopGroup[selStop] : -1) + '|' + innerWidth + 'x' + innerHeight + '|' + opt.lbl + '|' + plan.key + '|' + selSide + '|' + (plan.me ? plan.me.x : '');
  if (key !== LBL.key) { LBL.key = key; if (opt.lbl) rebuildLabels(); else LBL.count = 0; }
  if (!LBL.count) return;
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
  gl.useProgram(labelP.p); gl.uniformMatrix4fv(labelP.u.uVP, false, VP);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, LBL.tex); gl.uniform1i(labelP.u.uAtlas, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.texs[2]); gl.uniform1i(labelP.u.uD, 1);
  gl.uniform1i(labelP.u.uPs, R.ps); gl.uniform2i(labelP.u.uLow, R.low[0], R.low[1]);
  gl.uniform1f(labelP.u.uBias, 2 / (camB.far - camB.near));
  gl.bindVertexArray(LBL.vao); gl.drawArrays(gl.TRIANGLES, 0, LBL.count);
  gl.bindVertexArray(null); gl.disable(gl.BLEND);
}


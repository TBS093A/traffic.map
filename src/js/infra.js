/* ======================= INFRASTRUKTURA ======================= */
// Sieć energetyczna i maszty z OSM, stacje bazowe telefonii z wykazu UKE, stacje paliw i ładowarki EV z OSM.
// Widoczne w trybie „Infrastruktura”; znaczniki (paliwo, ładowarki, stacje bazowe) rosną przy oddaleniu jak przystanki.
let INFRA = null, BTS = null, infraBox = null, infraScale = 0, selInfra = null, infraPts = [];
const OP_COL = { Orange: [1, .47, 0], Play: [.55, .27, .68], 'T-Mobile': [.89, 0, .45], Plus: [.18, .62, .29], 'PKP PLK': [.12, .31, .6] };
const FUEL_BRANDS = [[/orlen/i, [.85, .1, .12]], [/\bbp\b/i, [.1, .55, .2]], [/shell/i, [.98, .8, .1]], [/circle/i, [.9, .3, .1]],
  [/moya/i, [.1, .35, .75]], [/lotos/i, [.95, .75, .1]], [/amic/i, [.2, .45, .8]], [/leclerc|auchan|carrefour/i, [.2, .4, .7]]];
const fuelCol = b => (FUEL_BRANDS.find(([re]) => re.test(b || '')) || [0, [.45, .5, .56]])[1];
const MAST_KIND = ['Maszt telekomunikacyjny', 'Maszt nadawczy RTV', 'Wieża kontroli lotów'];
const pylonH = kv => kv >= 380 ? 42 : kv >= 200 ? 35 : kv >= 100 ? 26 : 20;

function initInfra() {
  INFRA = D.map && D.map.infra ? D.map.infra : null;
  BTS = D.bts || null;
  infraPts = [];
  if (INFRA) {
    for (const [x, y, h, kind, name] of INFRA.m) infraPts.push({ type: 'mast', x, y, h, kind, name });
    for (const [x, y, ev, name, info] of INFRA.f) infraPts.push({ type: ev ? 'ev' : 'fuel', x, y, h: 6, name, info });
  }
  if (BTS) for (const [x, y, loc, tx] of BTS.s) infraPts.push({ type: 'bts', x, y, h: 22, name: loc, tx: tx.map(([o, t]) => [BTS.ops[o], t]) });
}

function buildInfra(s) {
  const inst = [], box = (x, y, b, a, l, h, w, c, k = 2) => inst.push(x, b, -y, a, l, h, w, k, c[0], c[1], c[2], 0);
  const STEEL = [.55, .57, .6], WIRE = [.16, .16, .18], WOOD = [.42, .37, .32];
  const t = Math.max(1, s / 3);                                   // z daleka grubsze słupy i przewody, żeby linie było widać
  if (INFRA) {
    for (const [kv, minor, enc] of INFRA.pw.l) {               // słupy w wierzchołkach linii, przewody między nimi
      const p = undelta(enc), n = p.length / 2, H = minor ? 9 : pylonH(kv);
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), ang = Math.atan2(p[2 * b + 1] - p[2 * a + 1], p[2 * b] - p[2 * a]);
        const x = p[2 * i], y = p[2 * i + 1];
        if (minor) { box(x, y, 0, ang, .35 * t, H, .35 * t, WOOD); box(x, y, H - .6, ang + Math.PI / 2, 2.4, .25 * t, .25 * t, STEEL); }
        else { box(x, y, 0, ang, 3 * t, H, 3 * t, STEEL); box(x, y, H * .55, ang, 1.6 * t, H * .45 + 4, 1.6 * t, STEEL); box(x, y, H - 3, ang + Math.PI / 2, 16, .8 * t, 1 * t, STEEL); }
      }
      for (let i = 0; i + 1 < n; i++) {
        const ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * i + 2], by = p[2 * i + 3], L = Math.hypot(bx - ax, by - ay); if (L < 1) continue;
        const ang = Math.atan2(by - ay, bx - ax), mx = (ax + bx) / 2, my = (ay + by) / 2, nx = -(by - ay) / L, ny = (bx - ax) / L;
        if (minor) box(mx, my, H - .7, ang, L, .15 * t, .15 * t, WIRE);
        else for (const off of [-6.5, 0, 6.5]) box(mx + nx * off, my + ny * off, H - 3.6, ang, L, .3 * t, .3 * t, WIRE);
      }
    }
  }
  const m = Math.max(1, s / 2);                                   // znaczniki: z daleka większe
  for (const P of infraPts) {
    const { x, y } = P;
    if (P.type === 'mast') {
      if (P.kind === 1) for (let k = 0; k < 6; k++) box(x, y, P.h * k / 6, 0, 3.5, P.h / 6, 3.5, k % 2 ? [.95, .95, .95] : [.85, .15, .12]);
      else if (P.kind === 2) { box(x, y, 0, 0, 5, P.h - 6, 5, [.86, .86, .84], 0); box(x, y, P.h - 6, .4, 9, 5, 9, [.36, .38, .42], 10); }
      else { box(x, y, 0, 0, 2.2, P.h, 2.2, STEEL); box(x, y, P.h, 0, .4, 5, .4, STEEL); }
    } else if (P.type === 'bts') {                               // stacja bazowa: maszt i kostki w kolorach operatorów
      box(x, y, 0, 0, 1.2 * m, 18 * m, 1.2 * m, STEEL);
      P.tx.forEach(([op], k) => box(x, y, (18 + k * 2.6) * m, k * .5, 2.2 * m, 2.2 * m, 2.2 * m, OP_COL[op] || [.6, .6, .65]));
      P.h = (18 + P.tx.length * 2.6) * m;
    } else if (P.type === 'fuel') {                              // wiata dystrybutorów w kolorze marki
      const c = fuelCol(P.name);
      for (const [u, v] of [[-5, -3], [5, -3], [-5, 3], [5, 3]]) box(x + u * m, y + v * m, 0, 0, .6 * m, 5 * m, .6 * m, [.8, .8, .8]);
      box(x, y, 5 * m, 0, 14 * m, 1.2 * m, 10 * m, c);
      box(x + 9 * m, y, 0, 0, 1 * m, 7 * m, 2.4 * m, c);
      P.h = 7 * m;
    } else if (P.type === 'ev') {                                // słupek ładowarki z zielonym panelem
      box(x, y, 0, 0, 1.2 * m, 2.4 * m, .8 * m, [.92, .93, .92]);
      box(x, y, 2.4 * m, 0, 1.3 * m, .9 * m, .9 * m, [.15, .75, .35]);
      P.h = 3.3 * m;
    }
  }
  return new Float32Array(inst);
}
function syncInfra() {
  if (!modes.infra || (!INFRA && !BTS)) return false;
  const sc = stopScaleFor(cam.half);
  if (sc !== infraScale || !infraBox) {
    infraScale = sc;
    if (infraBox) { gl.deleteVertexArray(infraBox.vao); gl.deleteBuffer(infraBox.buf); }
    infraBox = boxVAO(buildInfra(sc), false);
  }
  return true;
}
function drawInfra() {
  if (!syncInfra() || !infraBox.count) return;
  gl.bindVertexArray(infraBox.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, infraBox.count);
}

function pickInfra(px, py, best) {
  let hit = null;
  if (!modes.infra) return [best, hit];
  infraPts.forEach((P, i) => {
    const [sx, sy] = worldToScreen(P.x, P.h, -P.y), [gx, gy] = worldToScreen(P.x, P.h / 2, -P.y);
    const d = Math.min(Math.hypot(sx - px, sy - py), Math.hypot(gx - px, gy - py));
    if (d < best) { best = d; hit = i; }
  });
  return [best, hit];
}
function selectInfra(i) {
  selInfra = i;
  if (i !== null) { selTrip = -1; selStop = -1; selRoute = -1; follow = false; selAir = null; setUiMode('infra', true); }
  lastSheet = 0; renderSheet();
}
const GEN = t => /^5G/.test(t) ? '5G' : /^LTE/.test(t) ? '4G' : /^UMTS/.test(t) ? '3G' : /^GSM-R/.test(t) ? 'GSM-R' : /^GSM/.test(t) ? '2G' : t;
function infraSheet() {
  const P = infraPts[selInfra]; if (!P) return '';
  const head = (ic, t, sub) => `<button class="close" data-act="close">✕</button><h2>${ic} ${esc(t)}</h2><div class="sub">${sub}</div>`;
  if (P.type === 'fuel') return head('⛽', P.name || 'Stacja paliw', esc(P.info || 'stacja paliw'))
    + '<p class="note">Ceny paliw na poszczególnych stacjach nie są dostępne w otwartych danych, więc mapa ich nie pokazuje.</p><p class="note">Dane: OpenStreetMap (ODbL).</p>';
  if (P.type === 'ev') return head('🔌', P.name || 'Ładowarka EV', esc(P.info || 'stacja ładowania samochodów elektrycznych'))
    + '<p class="note">Dane: OpenStreetMap (ODbL). Dostępność i ceny ładowania podaje operator ładowarki.</p>';
  if (P.type === 'mast') return head(P.kind === 2 ? '🗼' : '📡', P.name || MAST_KIND[P.kind], `${MAST_KIND[P.kind]} · ok. ${P.h} m`) + '<p class="note">Dane: OpenStreetMap (ODbL).</p>';
  const gens = [...new Set(P.tx.flatMap(([, t]) => t.split(' ').map(GEN)))].sort();
  const rows = P.tx.map(([op, t]) => `<li><span class="chip" style="background:${rgbCss((OP_COL[op] || [.6, .6, .65]).map(v => v * 255))}">${esc(op)}</span><span class="grow">${esc(t.split(' ').join(', '))}</span></li>`).join('');
  return head('📶', 'Stacja bazowa telefonii', `${esc(P.name || '')}<br>${gens.join(' · ')}`) + `<ul class="list">${rows}</ul>`
    + '<p class="note">Systemy i pasma z pozwoleń radiowych UKE (wykaz pozwoleń radiowych). Lokalizacja to miejsce anteny, nie zasięg sieci.</p>';
}

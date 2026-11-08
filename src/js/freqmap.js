/* ======================= CZĘSTOTLIWOŚĆ I ZASIĘG (mapa i UI) ======================= */
const FM = { freq: false, freqGeo: [], freqKey: '', iso: null, isoBuf: null, isoVao: null, isoCount: 0, isoLabel: '' };

// --- mapa częstotliwości: trasy w kolorze i grubości wg liczby kursów na godzinę
function syncFreq(w) {
  if (!FM.freq) return;
  const key = w.ymd + ':' + Math.floor(w.sec / 600);
  if (key === FM.freqKey) return; FM.freqKey = key;
  for (const g of FM.freqGeo) { gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.buf); }
  FM.freqGeo = [];
  const per = routeFrequency(w.ymd, w.sec), bands = FREQ_BANDS.map(() => []);
  for (const [shape, n] of per) { const b = freqBand(n); if (b >= 0) bands[b].push(shape); }
  for (let b = bands.length - 1; b >= 0; b--) {             // najczęstsze rysowane na końcu, na wierzchu
    if (!bands[b].length) continue;
    const g = stripGeo(bands[b]), v = vaoFrom(g, STRIP);
    FM.freqGeo.push({ ...v, count: g.length / 7, color: FREQ_BANDS[b][1], w: 1 + (FREQ_BANDS.length - 1 - b) * .45 });
  }
}
function drawFreq(texel) {
  if (!FM.freq) return;
  gl.uniform1i(roadP.u.uMode, 1); gl.uniform1f(roadP.u.uY, .1);
  for (const g of FM.freqGeo) {
    gl.uniform1f(roadP.u.uHW, Math.max(2.2 * g.w, texel * 1.2 * g.w)); gl.uniform3f(roadP.u.uHL, g.color[0] / 255, g.color[1] / 255, g.color[2] / 255);
    gl.bindVertexArray(g.vao); gl.drawArrays(gl.TRIANGLES, 0, g.count);
  }
}

// --- zasięg (izochrony): kreskowane koła wokół osiągalnych słupków, promień = dojście w pozostałym czasie
const isoP = prog(COMMON + `
layout(location=0) in vec2 aC; layout(location=1) in vec4 iA; out vec2 vC; flat out int vB;
void main(){ vC=aC; vB=int(iA.w+.5); vec2 xz=vec2(iA.x+aC.x*iA.z, -(iA.y+aC.y*iA.z)); gl_Position=uVP*vec4(xz.x, .05+.01*(3.-iA.w)+demAt(xz)+demLift(), xz.y, 1.); }`,
COMMON + `
in vec2 vC; flat in int vB; uniform vec3 uBand[4]; layout(location=0) out vec4 oC; layout(location=1) out vec4 oN;
void main(){
  if(dot(vC,vC)>1.) discard;
  ivec2 q=ivec2(gl_FragCoord.xy); if(((q.x+q.y)&1)==0 && dot(vC,vC)<.86) discard;   // kreskowanie w środku, pełny brzeg
  oC=vec4(uBand[vB]*toon(vec3(0,1,0))*1.15,1.); oN=vec4(.5,1.,.5,1.);
}`);
function buildIso(times) {
  const inst = [], walkV = 1.2 / 1.25;
  for (let b = ISO_BANDS.length - 1; b >= 0; b--) {
    const lim = ISO_BANDS[b][0];
    times.forEach((t, s) => { if (t <= lim) inst.push(D.stops[s][0], D.stops[s][1], Math.min(500, Math.max(25, (lim - t) * walkV)), b); });
  }
  if (!FM.isoVao) {
    FM.isoVao = gl.createVertexArray(); gl.bindVertexArray(FM.isoVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    FM.isoBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, FM.isoBuf);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, FM.isoBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(inst), gl.DYNAMIC_DRAW);
  FM.isoCount = inst.length / 4;
}
const isoColors = new Float32Array(ISO_BANDS.flatMap(b => b[1].map(c => c / 255)));
function drawIso(sun) {
  if (!FM.iso || !FM.isoCount) return;
  gl.useProgram(isoP.p); gl.uniformMatrix4fv(isoP.u.uVP, false, VP); setDem(isoP);
  gl.uniform3fv(isoP.u.uSun, sun.sun); gl.uniform3fv(isoP.u.uSunCol, sun.sunCol); gl.uniform3fv(isoP.u.uAmb, sun.amb); gl.uniform3fv(isoP.u.uBand, isoColors);
  gl.bindVertexArray(FM.isoVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, FM.isoCount);
}
function showReach(si) {
  const g = S.groups[S.stopGroup[si]], w = warsaw(simMs());
  const t1 = performance.now();
  FM.iso = reachFrom({ kind: 'stop', g: g.id, label: g.name }, w.ymd, Math.floor(w.sec), ISO_BANDS[ISO_BANDS.length - 1][0]);
  FM.isoLabel = `${g.name}, ${fmtT(w.sec)}`; FM.isoMs = Math.round(performance.now() - t1);
  buildIso(FM.iso); cam.half = Math.max(cam.half, 2200); cam.x = g.x; cam.z = -g.y; follow = false;
  renderLegend();
}

// --- legenda w prawym dolnym rogu
function renderLegend() {
  const el = $('#legend'); let html = '';
  if (FM.freq) html += `<div class="lgh">🔥 Kursy na godzinę <button data-lg="freq" aria-label="Wyłącz mapę częstotliwości">✕</button></div>` + FREQ_BANDS.map(([, c, t]) => `<div><i style="background:${rgbCss(c)}"></i>${t}</div>`).join('');
  if (FM.iso) {
    const n = FM.iso.filter(t => t <= ISO_BANDS[ISO_BANDS.length - 1][0]).length;
    html += `<div class="lgh">⏱ Zasięg: ${esc(FM.isoLabel)} <button data-lg="iso" aria-label="Wyłącz zasięg">✕</button></div>` + ISO_BANDS.map(([, c, t]) => `<div><i style="background:${rgbCss(c)}"></i>do ${t}</div>`).join('')
      + `<div class="mut">${n} słupków · ${FM.isoMs} ms</div>`;
  }
  el.innerHTML = html; el.hidden = !html;
}
function toggleFreq(on = !FM.freq) { FM.freq = on; FM.freqKey = ''; renderLegend(); if (on) toastFor('Mapa częstotliwości: kursy na godzinę o tej porze'); }
$('#bFreq').onclick = () => { toggleFreq(); $('#linesOv').classList.remove('show'); };
$('#legend').addEventListener('click', e => {
  const b = e.target.closest('[data-lg]'); if (!b) return;
  if (b.dataset.lg === 'freq') toggleFreq(false); else { FM.iso = null; FM.isoCount = 0; renderLegend(); }
});

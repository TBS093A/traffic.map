/* ======================= RENDER ======================= */
let lastFrame = performance.now(), simState = null;
function render(now) {
  const dt = Math.min(.1, (now - lastFrame) / 1000); lastFrame = now;
  resize();
  cam.yaw += (cam.yawT - cam.yaw) * Math.min(1, dt * 9);
  const ms = simMs();
  simState = computeBuses(ms); buses = simState.buses;
  if (follow && selTrip >= 0) { const b = buses.find(b => b.ti === selTrip); if (b) { cam.x = lerp(cam.x, b.x, Math.min(1, dt * 4)); cam.z = lerp(cam.z, -b.y, Math.min(1, dt * 4)); } }
  updateCamera();
  const sun = sunState(simState.w.month, simState.w.sec, simState.w.ymd), season = seasonState(simState.w), fx = sun.fx;
  const nDyn = fillDyn(); setHighlight();

  gl.bindFramebuffer(gl.FRAMEBUFFER, R.fbo);
  gl.viewport(0, 0, R.low[0], R.low[1]);
  const bg = [lerp(.38, .05, sun.night), lerp(.52, .06, sun.night), lerp(.36, .1, sun.night)];
  gl.clearBufferfv(gl.COLOR, 0, [...bg, 1]); gl.clearBufferfv(gl.COLOR, 1, [.5, 1, .5, 1]); gl.clearBufferfi(gl.DEPTH_STENCIL, 0, 1, 0);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND);
  const t = now / 1000;
  const common = P => { gl.useProgram(P.p); gl.uniformMatrix4fv(P.u.uVP, false, VP); gl.uniform3fv(P.u.uSun, sun.sun); gl.uniform3fv(P.u.uSunCol, sun.sunCol); gl.uniform3fv(P.u.uAmb, sun.amb); if (P.u.uNight) gl.uniform1f(P.u.uNight, sun.night); if (P.u.uTime) gl.uniform1f(P.u.uTime, t);
    if (P.u.uSnow) gl.uniform1f(P.u.uSnow, season.snow); if (P.u.uAutumn) gl.uniform1f(P.u.uAutumn, season.autumn); if (P.u.uWinter) gl.uniform1f(P.u.uWinter, season.winter); if (P.u.uWet) gl.uniform1f(P.u.uWet, fx.wet); };

  common(groundP); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.distTex); gl.uniform1i(groundP.u.uDist, 0); gl.uniform1f(groundP.u.uExt, EXT); gl.uniform1f(groundP.u.uTexel, 2 * cam.half / R.low[1]); gl.uniform1i(groundP.u.uReal, WORLD ? 1 : 0); gl.bindVertexArray(groundV.vao); gl.drawArrays(gl.TRIANGLES, 0, 6);
  const texel = 2 * cam.half / R.low[1];
  if (WORLD) { // teren leży w płaszczyźnie gruntu: kolejność rysowania decyduje, co jest na wierzchu
    gl.disable(gl.DEPTH_TEST);
    common(landP); gl.uniform1f(landP.u.uTexel, texel); gl.bindVertexArray(WORLD.land.vao); gl.drawArrays(gl.TRIANGLES, 0, WORLD.land.count);
    gl.enable(gl.DEPTH_TEST);
  }
  common(roadP);
  const drawLine = L => { if (cam.half > L.maxHalf) return; gl.uniform1i(roadP.u.uMode, L.mode); gl.uniform1f(roadP.u.uY, .04); gl.uniform1f(roadP.u.uHW, Math.max(L.hw, texel * L.px)); gl.bindVertexArray(L.vao); gl.drawArrays(gl.TRIANGLES, 0, L.count); };
  if (WORLD) { WORLD.waterLines.forEach(drawLine); WORLD.roads.forEach(drawLine); WORLD.bridges.forEach(drawLine); }
  else { gl.uniform1i(roadP.u.uMode, 0); gl.uniform1f(roadP.u.uY, .04); gl.uniform1f(roadP.u.uHW, Math.max(4.5, texel * .9)); gl.bindVertexArray(roadV.vao); gl.drawArrays(gl.TRIANGLES, 0, roadCount); }
  if (hlGeo) {
    const c = D.routes[selTrip >= 0 ? S.trips[selTrip].route : selRoute].c;
    gl.uniform1i(roadP.u.uMode, 1); gl.uniform1f(roadP.u.uY, .12); gl.uniform1f(roadP.u.uHW, Math.max(2.8, texel * 1.6)); gl.uniform3f(roadP.u.uHL, c[0] / 255, c[1] / 255, c[2] / 255);
    gl.bindVertexArray(hlGeo.vao); gl.drawArrays(gl.TRIANGLES, 0, hlGeo.count);
  }
  setPlanGeo();
  for (const g of plan.geo) {
    gl.uniform1i(roadP.u.uMode, g.mode); gl.uniform1f(roadP.u.uY, .16);
    gl.uniform1f(roadP.u.uHW, g.mode === 2 ? Math.max(1.6, texel * 1.1) : Math.max(3.2, texel * 1.9));
    gl.uniform3f(roadP.u.uHL, g.color[0] / 255, g.color[1] / 255, g.color[2] / 255);
    gl.bindVertexArray(g.vao); gl.drawArrays(gl.TRIANGLES, 0, g.count);
  }
  common(boxP);
  if (opt.bld && WORLD) {
    const lvl = lodLevel(), vb = viewBounds();
    drawTiles(WORLD.boxes, lvl, vb); drawTiles(WORLD.trees, lvl, vb);
    common(meshP); drawMesh(lvl, vb); common(boxP);
  } else if (opt.bld) { gl.bindVertexArray(staticBox.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, staticBox.count); }
  syncStops(); gl.bindVertexArray(stopBox.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, stopBox.count);
  if (nDyn) { gl.bindBuffer(gl.ARRAY_BUFFER, dynBox.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, dyn, 0, nDyn * 12); gl.bindVertexArray(dynBox.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, nDyn); }

  // post
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.disable(gl.DEPTH_TEST);
  gl.useProgram(postP.p); gl.bindVertexArray(null);
  R.texs.forEach((tx, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tx); });
  gl.uniform1i(postP.u.uC, 0); gl.uniform1i(postP.u.uN, 1); gl.uniform1i(postP.u.uD, 2);
  gl.uniform1i(postP.u.uPs, R.ps); gl.uniform2i(postP.u.uLow, R.low[0], R.low[1]);
  gl.uniform1i(postP.u.uPal, opt.pal); gl.uniform1i(postP.u.uDith, opt.dith); gl.uniform1i(postP.u.uOut, opt.out);
  gl.uniform1f(postP.u.uThr, 1.6 / (camB.far - camB.near));
  gl.uniform3fv(postP.u.uPalette, palF); gl.uniform1i(postP.u.uPalN, PALETTE.length);
  gl.uniform1f(postP.u.uRain, fx.rain); gl.uniform1f(postP.u.uSnowFall, fx.snowFall); gl.uniform1f(postP.u.uFog, fx.fog); gl.uniform1f(postP.u.uTime, t);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  drawLabels();

  updateBadges(); updateUI(now);
  requestAnimationFrame(render);
}

/* ======================= ETYKIETY NAD AUTOBUSAMI ======================= */
const badgePool = [];
function updateBadges() {
  const host = $('#badges'); let n = 0;
  const far = cam.half > 1500;                           // z daleka mniejsze, żeby się nie zlewały
  for (const b of buses) {
    if (b.ti < 0) continue;
    const tr = S.trips[b.ti];
    const isSel = b.ti === selTrip || (plan.sel >= 0 && plan.options[plan.sel].legs.some(l => l.ti === b.ti)), inRoute = selRoute >= 0 && tr.route === selRoute;
    const [sx, sy] = worldToScreen(b.x, (b.h || 0) + busScale() * 3.1, -b.y);   // tuż nad dachem
    if (sx < -30 || sy < -30 || sx > innerWidth + 30 || sy > innerHeight + 30) continue;
    if (n >= 600) break;
    let el = badgePool[n]; if (!el) { el = document.createElement('div'); el.className = 'badge'; host.appendChild(el); badgePool.push(el); }
    const c = D.routes[tr.route].c, txt = D.routes[tr.route].n;
    if (el._t !== txt) { el.textContent = txt; el._t = txt; }
    const bgc = (selRoute >= 0 && !inRoute && !isSel) ? '#8c8c96' : rgbCss(c);
    if (el._c !== bgc) { el.style.background = bgc; el._c = bgc; }
    el._ti = b.ti; el.classList.toggle('sel', isSel); el.classList.toggle('far', far && !isSel && !inRoute);
    el.style.left = sx + 'px'; el.style.top = sy + 'px'; el.style.display = '';
    n++;
  }
  for (let i = n; i < badgePool.length; i++) badgePool[i].style.display = 'none';
}


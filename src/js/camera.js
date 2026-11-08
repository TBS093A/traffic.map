/* ======================= KAMERA ======================= */
const cam = { x: 0, z: 0, yaw: Math.PI / 4, yawT: Math.PI / 4, elev: 30 * Math.PI / 180, half: store.get('half', 520) };
const camSaved = store.get('cam', null); if (camSaved) { cam.x = camSaved[0]; cam.z = camSaved[1]; cam.yaw = cam.yawT = camSaved[2]; }
let VP, camB = {};
function updateCamera() {
  const W = canvas.width, H = canvas.height, aspect = W / H, half = cam.half, halfW = half * aspect;
  const ce = Math.cos(cam.elev), se = Math.sin(cam.elev);
  const F = [ce * Math.sin(cam.yaw), se, ce * Math.cos(cam.yaw)];
  const Rv = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
  const U = [F[1] * Rv[2] - F[2] * Rv[1], F[2] * Rv[0] - F[0] * Rv[2], F[0] * Rv[1] - F[1] * Rv[0]];
  const DIST = 20000; let eye = [cam.x + F[0] * DIST, F[1] * DIST, cam.z + F[2] * DIST];
  // przyciąganie do siatki pikseli (stabilny pixel-art przy przesuwaniu)
  const texel = 2 * half / R.low[1];
  const er = eye[0] * Rv[0] + eye[1] * Rv[1] + eye[2] * Rv[2], eu = eye[0] * U[0] + eye[1] * U[1] + eye[2] * U[2];
  const sr = Math.round(er / texel) * texel - er, su = Math.round(eu / texel) * texel - eu;
  eye = [eye[0] + Rv[0] * sr + U[0] * su, eye[1] + Rv[1] * sr + U[1] * su, eye[2] + Rv[2] * sr + U[2] * su];
  const near = 10, far = 60000;
  VP = M4.mul(M4.ortho(-halfW, halfW, -half, half, near, far), M4.view(eye, Rv, U, F));
  camB = { eye, F, Rv, U, half, halfW, W, H, near, far };
}
function screenToGround(px, py) { // piksele CSS -> punkt na ziemi (x, z świata)
  const { eye, F, Rv, U, half, halfW } = camB;
  const sx = (px / innerWidth) * 2 - 1, sy = 1 - (py / innerHeight) * 2;
  const o = [eye[0] + Rv[0] * sx * halfW + U[0] * sy * half, eye[1] + Rv[1] * sx * halfW + U[1] * sy * half, eye[2] + Rv[2] * sx * halfW + U[2] * sy * half];
  let t = o[1] / F[1], x = o[0] - F[0] * t, z = o[2] - F[2] * t;
  for (let i = 0; i < 4 && terrK(); i++) {        // z rzeźbą terenu: przecięcie promienia z powierzchnią, kilka przybliżeń
    t = (o[1] - demH(x, -z)) / F[1]; x = o[0] - F[0] * t; z = o[2] - F[2] * t;
  }
  return [x, z];
}
function worldToScreen(x, y, z) {               // y nad terenem
  y += demH(x, -z);
  const m = VP, cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  return [(cx + 1) / 2 * innerWidth, (1 - cy) / 2 * innerHeight];
}
function zoomAt(px, py, f) {
  const g1 = screenToGround(px, py);
  cam.half = clamp(cam.half * f, 40, 7000); updateCamera();
  const g2 = screenToGround(px, py); cam.x += g1[0] - g2[0]; cam.z += g1[1] - g2[1];
  follow = false;
}


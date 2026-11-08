/* ======================= MATEMATYKA ======================= */
const M4 = {
  mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
  ortho(l, r, b, t, n, f) { const o = new Float32Array(16); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o; },
  view(eye, R, U, F) { // F = kierunek od celu do oka
    return new Float32Array([R[0], U[0], F[0], 0, R[1], U[1], F[1], 0, R[2], U[2], F[2], 0,
      -(R[0] * eye[0] + R[1] * eye[1] + R[2] * eye[2]), -(U[0] * eye[0] + U[1] * eye[1] + U[2] * eye[2]), -(F[0] * eye[0] + F[1] * eye[1] + F[2] * eye[2]), 1]);
  }
};

/* ======================= USTAWIENIA ======================= */
const opt = { wx: store.get('wx', 'auto'), season: store.get('season', 'auto'), ps: store.get('ps', 2), pal: store.get('pal', 1), dith: store.get('dith', 1), out: store.get('out', 1), tod: store.get('tod', 'auto'), bld: store.get('bld', 1), lbl: store.get('lbl', 1) };

/* ======================= WEBGL ======================= */
const canvas = $('#c');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });

function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').slice(0, 3).join('\n')); return s; }
function prog(vs, fs) {
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}


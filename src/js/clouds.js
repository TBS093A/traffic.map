/* ======================= CHMURY ======================= */
// Za krawędzią danych (prostokąt mapy) mapa tonie w pixel-artowych chmurach; front banku ma zatoki i jęzory
// z szumu w skali kilometrów, więc nie odcina prostej krawędzi. Nad miastem pływa kilka cumulusów, tym więcej,
// im większe zachmurzenie z prognozy. Chmury to kształty, nie szum: suma kół (kłębów) na dwóch siatkach,
// z jasną krawędzią od słońca, cieniem po drugiej stronie i ciemnym obrysem od spodu. Wszystko dryfuje z wiatrem.
// Jeden pełnoekranowy przebieg w niskiej rozdzielczości: piksel, paleta i dithering z postprocessingu.
// Technika: promień z kamery (ortho) do płaszczyzny chmur, pomysł za mapą Krakowa michalpietralik.pl/cracowpixelmap.
const cloudP = prog(`#version 300 es
const vec2 v[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));
out vec2 vN; void main(){ vN=v[gl_VertexID]; gl_Position=vec4(vN,0.,1.); }`,
COMMON + `
in vec2 vN;
uniform vec3 uEye; uniform vec3 uRv; uniform vec3 uU; uniform vec3 uF; uniform vec2 uHalf; uniform vec2 uNF;
uniform vec4 uRect; uniform float uH; uniform float uCity; uniform vec2 uDrift;
uniform sampler2D uStopD; uniform vec4 uStopBox;               // odległość do najbliższego przystanku/stacji (siatka, m/8000)
layout(location=0) out vec4 oC; layout(location=1) out vec4 oN;
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=.5; } return s; }
// odległość (m) do sumy kół na siatce C; koło istnieje, gdy jego los < pokrycie
float puffs(vec2 p, float C, float cov, float seed){
  vec2 c=floor(p/C); float d=1e9;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 k=c+vec2(i,j); float h=h21(k+seed), h2=h21(k*1.7+seed+3.1), h3=h21(k*2.3+seed+7.7);
    if(h3>min(cov,.74)) continue;                            // nawet w pokładzie zostają przerwy, w których widać pokład
    vec2 o=(k+.2+.6*vec2(h,h2))*C; float r=C*(.36+.34*h2)*(.55+.55*cov);
    d=min(d,length(p-o)-r);
  }
  return d;
}
uniform float uZoom;                                          // z daleka chmury większe (jakby wisiały bliżej kamery)
float cloud(vec2 p, float cov){ return min(puffs(p,560.*uZoom,cov,0.), puffs(p+vec2(173.,91.)*uZoom,250.*uZoom,cov*.9,11.)); }
void main(){
  vec3 o=uEye+uRv*vN.x*uHalf.x+uU*vN.y*uHalf.y;
  float t=(o.y-uH)/uF.y; vec3 w=o-uF*t; vec2 m=vec2(w.x,-w.z);
  // odległość od prostokąta danych (> 0 na zewnątrz)
  vec2 q=max(uRect.xy-m, m-uRect.zw); float sd=length(max(q,0.))+min(max(q.x,q.y),0.);
  float front=fbm(m/4200.+3.7)*2.4-.55;                      // jak głęboko bank wchodzi nad mapę (zatoki, jęzory)
  float bank=smoothstep(-front*1600.-250., 350., sd);
  // miasto i okolice z komunikacją zostają odkryte; pola i lasy daleko od przystanków i stacji zakrywa bank
  vec2 uv=(m-uStopBox.xy)/uStopBox.zw;
  float ds=(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) ? 8000. : texture(uStopD,uv).r*8000.;
  float clear=1100.+(fbm(m/2600.+9.1)-.5)*1600.;              // zasięg przejaśnienia wokół sieci, z falującym brzegiem
  bank=max(bank, smoothstep(clear, clear+700., ds));
  float city=uCity*smoothstep(.5,.78,fbm(m/1700.-uDrift/1700.));   // pojedyncze cumulusy nad miastem
  float cov=max(bank,city);
  if(cov<.03) discard;
  vec2 p=m-uDrift;
  float s=cloud(p,cov);
  bool deck=bank>.93;                                         // daleko za krawędzią: zwarty pokład, bez prześwitów
  if(s>0.&&!deck) discard;
  vec2 L=vec2(-.62,.78);                                      // światło z lewej góry ekranu
  vec3 hi=vec3(1.,1.,1.), lit=vec3(.92,.94,.98), sh=vec3(.74,.78,.88), ol=vec3(.55,.6,.74), dk=vec3(.66,.7,.82);
  vec3 col; float z=uZoom;
  if(s>0.) col=dk;                                            // pokład: ton niżej niż cień, kłęby się na nim odcinają
  else if(s>-16.*z&&cloud(p-L*40.*z,cov)>0.) col=ol;         // obrys od spodu
  else if(cloud(p+L*70.*z,cov)>0.) col=hi;                    // jasna krawędź od słońca
  else if(cloud(p-L*60.*z,cov)>0.) col=sh;                    // cień po przeciwnej stronie
  else col=lit;
  col=mix(col,col*vec3(.24,.27,.4),uNight*.8);
  oC=vec4(col,.5); oN=vec4(.5,1.,.5,1.);
  gl_FragDepth=clamp((t-uNF.x)/(uNF.y-uNF.x),0.,1.);
}`);

const CLOUD_H = 260, CLOUD_WIND = [6, 2.2];                   // wysokość chmur (m) i wiatr (m/s)
function dataRect() {
  if (TERR.on) return [TERR.x0, TERR.y0, TERR.x0 + TERR.dx * (TERR.nx - 1), TERR.y0 + TERR.dy * (TERR.ny - 1)];
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of D.stops) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0 - 1500, y0 - 1500, x1 + 1500, y1 + 1500];
}
// siatka odległości do najbliższego przystanku lub stacji, co 300 m (raz, przy pierwszej klatce z chmurami)
let cloudRect = null, stopDist = null;
function buildStopDist() {
  const [x0, y0, x1, y1] = cloudRect, M = 4000, C = 300, bx = x0 - M, by = y0 - M, W = x1 - x0 + 2 * M, H = y1 - y0 + 2 * M;
  const nx = Math.ceil(W / C), ny = Math.ceil(H / C), grid = new Uint8Array(nx * ny);
  const pts = []; const seen = new Set();
  for (const [x, y] of D.stops) { const k = Math.round(x / 100) + ',' + Math.round(y / 100); if (!seen.has(k)) { seen.add(k); pts.push(x, y); } }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cx = bx + (i + .5) * C, cy = by + (j + .5) * C; let best = 64e6;
    for (let p = 0; p < pts.length; p += 2) { const dx = pts[p] - cx, dy = pts[p + 1] - cy, d = dx * dx + dy * dy; if (d < best) best = d; }
    grid[j * nx + i] = Math.min(255, Math.round(Math.sqrt(best) / 8000 * 255));
  }
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, nx, ny, 0, gl.RED, gl.UNSIGNED_BYTE, grid);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  stopDist = { tex, box: [bx, by, nx * C, ny * C] };
}
function drawClouds(sun, t) {
  if (!opt.clouds) return;
  if (!cloudRect) { cloudRect = dataRect(); buildStopDist(); }
  const P = cloudP, { eye, Rv, U, F, half, halfW, near, far } = camB;
  gl.useProgram(P.p);
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, stopDist.tex); gl.uniform1i(P.u.uStopD, 6); gl.uniform4fv(P.u.uStopBox, stopDist.box);
  gl.uniform3fv(P.u.uEye, eye); gl.uniform3fv(P.u.uRv, Rv); gl.uniform3fv(P.u.uU, U); gl.uniform3fv(P.u.uF, F);
  gl.uniform2f(P.u.uHalf, halfW, half); gl.uniform2f(P.u.uNF, near, far);
  gl.uniform4fv(P.u.uRect, cloudRect); gl.uniform1f(P.u.uH, CLOUD_H);
  const cloudy = wxNow() ? clamp(WX.cur.cloud / 100, 0, 1) : .3;
  gl.uniform1f(P.u.uCity, .15 + .55 * cloudy); gl.uniform2f(P.u.uDrift, CLOUD_WIND[0] * t, CLOUD_WIND[1] * t);
  gl.uniform1f(P.u.uNight, sun.night); gl.uniform1f(P.u.uZoom, clamp(half / 1800, 1, 3.5));
  gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
}

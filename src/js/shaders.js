// rzeźba terenu: wysokość z tekstury (siatka DEM w metrach), interpolacja dwuliniowa; xz to współrzędne świata (z = -północ)
const DEM_GLSL = `
uniform sampler2D uDem; uniform vec4 uDemBox; uniform vec2 uDemN; uniform float uDemK;
float demTex(ivec2 p){ return texelFetch(uDem, clamp(p, ivec2(0), ivec2(uDemN)-1), 0).r; }
float demAt(vec2 xz){
  if(uDemK==0.) return 0.;
  vec2 g=clamp((vec2(xz.x,-xz.y)-uDemBox.xy)/uDemBox.zw, vec2(0.), uDemN-1.001), i=floor(g), f=g-i; ivec2 p=ivec2(i);
  return mix(mix(demTex(p),demTex(p+ivec2(1,0)),f.x), mix(demTex(p+ivec2(0,1)),demTex(p+ivec2(1,1)),f.x), f.y)*uDemK;
}
float demLift(){ return uDemK>0. ? .6 : 0.; }   // drogi i nakładki minimalnie nad siatką gruntu (inna gęstość wierzchołków)
vec3 demNormal(vec2 xz){
  if(uDemK==0.) return vec3(0,1,0);
  float e=max(uDemBox.z,uDemBox.w)*.5;
  return normalize(vec3(demAt(xz-vec2(e,0.))-demAt(xz+vec2(e,0.)), 2.*e, demAt(xz-vec2(0.,e))-demAt(xz+vec2(0.,e))));
}
`;
const COMMON = `#version 300 es
precision highp float;
uniform mat4 uVP; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uAmb; uniform float uNight; uniform float uTime;
${DEM_GLSL}
// cieniowanie stoków: ciągłe, delikatne, żeby wzgórza czytały się mimo trzech poziomów światła w toon()
vec3 hill(vec3 n){ return vec3(1.+clamp((dot(n,uSun)-dot(vec3(0,1,0),uSun))*1.6,-.35,.35)); }
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
vec3 toon(vec3 n){ float d=max(dot(n,uSun),0.); d=floor(d*3.+.35)/3.; return uAmb+uSunCol*d; }
// pora roku: liście jesienią, sucha trawa zimą, śnieg na poziomych powierzchniach
// foliage: 1 = liście drzew (pełne przebarwienie), .5 = trawa (lekko żółknie), 0 = bez zmian koloru
uniform float uSnow; uniform float uAutumn; uniform float uWinter; uniform float uWet;
vec3 seasonal(vec3 c, vec3 n, vec2 w, float foliage){
  float green=clamp((c.g-max(c.r,c.b))*6.,0.,1.)*step(.01,foliage);
  if(green>0.){
    float h=h21(floor(w/7.)), leaves=step(.75,foliage);
    vec3 aut=leaves>.5?(h<.45?vec3(.74,.43,.15):(h<.8?vec3(.66,.58,.2):vec3(.58,.22,.13))):vec3(.5,.52,.28);
    c=mix(c,aut*(.55+.6*length(c)),uAutumn*green*(leaves>.5?.55+.45*step(.3,h):.3));
    vec3 dry=vec3(dot(c,vec3(.3,.5,.2)))*vec3(1.05,.98,.84);
    c=mix(c,dry,uWinter*green*.75);
  }
  if(uSnow>0.&&n.y>.5){ float s=clamp(uSnow*1.35-vnoise(w/5.)*.55-vnoise(w/1.3)*.25,0.,1.); c=mix(c,vec3(.9,.93,.98),s); }
  return c;
}
`;

// --- grunt
const groundP = prog(COMMON + `
layout(location=0) in vec2 aP; out vec2 vW;
void main(){ vW=aP; gl_Position=uVP*vec4(aP.x,demAt(aP),aP.y,1.); }`,
COMMON + `
in vec2 vW; uniform sampler2D uDist; uniform float uExt; uniform float uTexel; uniform int uReal; layout(location=0) out vec4 oC; layout(location=1) out vec4 oN;
void main(){
  vec2 p=vec2(vW.x,-vW.y); vec3 up=demNormal(vW);
  vec2 uv=(p+uExt)/(2.*uExt);
  float dd = (uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) ? 255. : texture(uDist,uv).r*255.;
  float dm = dd*8.;
  float r=length(p);
  float n=vnoise(p/90.)*.6+vnoise(p/23.)*.4;
  vec3 col = n<.42?vec3(.27,.43,.23):(n<.62?vec3(.33,.5,.26):vec3(.4,.56,.29));
  if(uReal==1){ oC=vec4(seasonal(col,vec3(0,1,0),p,.5)*toon(up)*hill(up),1.); oN=vec4(up*.5+.5,1.); return; }
  // pola uprawne poza miastem
  if(dd>200. && r>2600.){
    vec2 cell=floor(p/vec2(140.,90.)); float h=h21(cell);
    vec2 q=p - cell*vec2(140.,90.);
    float stripe=uTexel<2.5 ? step(.5,fract((h>.5?q.x:q.y)/6.)) : 0.;
    vec3 f = h<.3? vec3(.52,.55,.3) : (h<.55? vec3(.42,.5,.26) : (h<.75? vec3(.6,.5,.33): vec3(.35,.47,.25)));
    col = mix(f, f*.88, stripe);
    if(q.x<max(2.5,uTexel)||q.y<max(2.5,uTexel)) col=vec3(.3,.42,.24);
  }
  // chodniki i place przy ulicach, gęściej w centrum
  float urban = exp(-r/2300.);
  float paveW = mix(10., 34., urban) + (vnoise(p/60.)-.5)*14.;
  if(dm < paveW || (r<900. && vnoise(p/70.) > .35)) col = mix(vec3(.66,.62,.56), vec3(.6,.57,.52), step(.6,vnoise(p/14.)));
  oC=vec4(seasonal(col,vec3(0,1,0),p,.5)*toon(up)*hill(up),1.); oN=vec4(up*.5+.5,1.);
}`);

// --- drogi i podświetlenie trasy
const roadP = prog(COMMON + `
layout(location=0) in vec4 aP; layout(location=1) in vec2 aUV; layout(location=2) in float aH; uniform float uY; uniform float uHW; out vec2 vUV;
void main(){ vUV=aUV; vec2 w=aP.xy+aP.zw*uHW; gl_Position=uVP*vec4(w.x,uY+aH+demAt(aP.xy)+demLift(),w.y,1.); }`,
COMMON + `
in vec2 vUV; uniform int uMode; uniform vec3 uHL; layout(location=0) out vec4 oC; layout(location=1) out vec4 oN;
void main(){
  oN=vec4(.5,1.,.5,1.);
  if(uMode==2){ if(fract(vUV.y/7.)<.42) discard; oC=vec4(vec3(.97,.97,.95),.5); return; }
  if(uMode==3){ vec3 c=abs(vUV.x)<.55 && fract(vUV.y/4.)<.45 ? vec3(.24,.22,.21) : vec3(.5,.47,.44); oC=vec4(c*toon(vec3(0,1,0)),1.); return; }
  if(uMode==4){ oC=vec4(vec3(.17,.34,.54)*toon(vec3(0,1,0)),1.); return; }
  if(uMode==1){
    float s=step(.5,fract((vUV.y-uTime*28.)/16.));
    vec3 c=uHL*(.8+.4*s)*(1.+.25*uNight);
    float edge=step(.7,abs(vUV.x));
    c=mix(c, c*.55, edge);
    oC=vec4(c,.5); return;
  }
  vec3 asph=vec3(.29,.28,.29);
  vec3 col = abs(vUV.x)>.8 ? vec3(.58,.56,.53) : asph;
  col*=1.-.28*uWet;                                   // mokry asfalt ciemnieje
  col=mix(col,vec3(.86,.88,.92),uSnow*.45*step(.45,fract(vUV.y/9.)*.6+abs(vUV.x)*.5));   // rozjeżdżony śnieg
  vec3 c = col*toon(vec3(0,1,0));
  c += vec3(.5,.55,.65)*uWet*.12*step(.75,fract(vUV.y/13.+abs(vUV.x)*.3));          // odblask na mokrej jezdni
  float ph=abs(fract(vUV.y/34.)-.5)*34.;
  float pool=exp(-ph*ph/30.)*(1.-abs(vUV.x)*.5);
  c += vec3(1.,.78,.42)*pool*.55*uNight;
  oC=vec4(c,1.);
}`);

// --- instancjonowane prostopadłościany: budynki, drzewa, przystanki, autobusy
const SOLID_FS = COMMON + `
in vec3 vNor; in vec3 vLN; in vec3 vCol; in vec3 vLoc; in vec3 vSize; in vec3 vWP; flat in float vKind; flat in float vSeed;
layout(location=0) out vec4 oC; layout(location=1) out vec4 oN;
void main(){
  vec3 n=normalize(vNor); int k=int(vKind+.5); vec3 col=vCol; vec3 emis=vec3(0); float flag=1.;
  bool side=abs(vLN.y)<.5;
  if(k>=9&&k<=12){                 // obiekty specjalne
    bool alongX=abs(vLN.z)>.5; float W=alongX?vSize.x:vSize.z, u=(alongX?vLoc.x:vLoc.z)+W*.5, v=vLoc.y, H=vSize.y;
    float r=fract(vSeed*.173);
    if(side){
      if(k==9){                    // galeria: przeszklony parter, jasna elewacja w pionowe pasy, gzyms
        if(v<4.5){ col=vec3(.24,.4,.58); emis=vec3(1.,.86,.55)*uNight*.8; }
        else col = fract(u/7.)<.08 ? vec3(.5,.5,.52) : vec3(.84,.82,.78);
        if(v>H-1.4) col=vec3(.36,.36,.4);
      } else if(k==10){            // biurowiec: szklana ściana kurtynowa
        vec2 c=vec2(floor(u/1.7),floor(v/3.6)), f=vec2(fract(u/1.7),fract(v/3.6));
        bool m=f.x<.12||f.y<.14;
        col = m ? vec3(.62,.66,.7) : mix(vec3(.24,.42,.62),vec3(.47,.67,.84),step(.55,h21(c+vSeed)));
        if(!m) emis=vec3(1.,.88,.6)*uNight*step(.55,h21(c*1.37+vSeed*3.1));
      } else if(k==11){            // kościół: wysokie, wąskie okna
        float w=step(.4,fract(u/4.5))*step(fract(u/4.5),.6)*step(2.5,v)*step(v,H-2.5);
        if(w>.5){ col=vec3(.22,.28,.42); emis=vec3(1.,.78,.4)*uNight*.7; }
      } else {                     // trybuna
        col=vec3(.62,.6,.57);
      }
    } else if(vLN.y>0.){
      if(k==9) col=mix(vec3(.6,.6,.6),vec3(.42,.43,.46),step(.9,h21(floor(vWP.xz/5.))));
      else if(k==10) col=vec3(.36,.38,.42);
      else if(k==11) col= r<.45 ? vec3(.62,.27,.2) : (r<.75 ? vec3(.33,.55,.47) : vec3(.3,.31,.36));
      else col=mix(vec3(.24,.42,.7),vec3(.86,.86,.84),step(.5,fract(vWP.x/2.5)));
    }
  } else if(k==0||k==7||k==8){
    if(side && k!=8){
      bool alongX = abs(vLN.z)>.5;
      float W = alongX? vSize.x : vSize.z;
      float u = (alongX? vLoc.x : vLoc.z) + W*.5;
      float v = vLoc.y;
      vec2 cell=vec2(floor(u/3.2), floor(v/3.));
      vec2 f=vec2(fract(u/3.2), fract(v/3.));
      float win=step(.28,f.x)*step(f.x,.72)*step(.32,f.y)*step(f.y,.78)*step(.9,u)*step(u,W-.9)*step(v,vSize.y-.7);
      if(win>.5){
        float lit=step(.52,h21(cell+vec2(vSeed*7.13,vSeed*3.71)+vLN.xz*11.));
        col=vec3(.2,.26,.36);
        emis=vec3(1.,.8,.42)*lit*uNight;
      }
    } else if(!side && vLN.y>0.){
      if(k==7){ float h=fract(vSeed*.173); col = h<.4? vec3(.62,.27,.2) : (h<.75? vec3(.52,.24,.2) : vec3(.42,.3,.27)); }
      else { col = mix(col, vec3(.56,.52,.46), .65); }
    }
  } else if(k==1){ col*= .9+.2*h21(vec2(vSeed)); }
  else if(k==4||k==5){
    flag=0.;
    float v=vLoc.y/vSize.y;
    if(vLN.y>.5) col=vec3(.92,.92,.9);
    else if(v>.5&&v<.86){ col=vec3(.14,.18,.25); emis=vec3(1.,.9,.6)*.5*uNight; }
    if(vLN.x>.5 && v<.38) emis+=vec3(1.,.95,.75)*uNight*1.2;
    if(vLN.x<-.5 && v<.38) emis+=vec3(.9,.1,.1)*uNight*.8;
    if(k==5) emis+=vec3(.22)*(.6+.4*sin(uTime*6.));
  } else if(k==3){ if(vLN.y>.5) col=vec3(.86,.86,.84); }
  else if(k==13){                  // dach dwuspadowy: rzędy dachówek na połaciach, szczyty w kolorze tynku
    if(abs(vLN.x)>.5) col=vec3(.88,.82,.7);
    else { col*=.86+.14*step(.5,fract(vLoc.y*1.7)); col*=.94+.06*step(.5,fract((vLoc.x+vSeed)/1.1)); }
  }
  else if(k==14||k==15){           // wagon: białe pudło, pas w kolorze przewoźnika, rząd okien; vSeed 1 = czoło, 2 = koniec składu
    flag=0.;
    float v=vLoc.y/vSize.y;
    col=vec3(.9,.91,.9);
    if(vLN.y>.5) col=vec3(.52,.54,.58);
    else if(v<.2) col=vCol*.8;
    else if(v<.3) col=vCol;
    else if(v>.42&&v<.78&&abs(vLN.z)>.5){ float f=fract(vLoc.x/2.4); if(f>.18&&f<.82){ col=vec3(.14,.18,.25); emis=vec3(1.,.92,.7)*.45*uNight; } }
    if(vLN.x>.5&&vSeed>.5&&vSeed<1.5){ col=v>.45?vec3(.12,.15,.2):vCol; emis+=vec3(1.,.95,.75)*uNight*step(v,.3)*1.2; }
    if(vLN.x<-.5&&vSeed>1.5&&v<.3) emis+=vec3(.9,.1,.1)*uNight;
    if(k==15) emis+=vec3(.22)*(.6+.4*sin(uTime*6.));
  }
  else if(k==16){ flag=0.; if(vLN.y<-.5) col*=.75; emis=col*.12*uNight; }   // samolot
  else if(k==17){ oC=vec4(vec3(.05,.06,.08),.5); oN=vec4(.5,1.,.5,1.); return; }   // cień samolotu na ziemi
  else if(k==6){ flag=0.; emis=vec3(.95,.82,.3)*(.6+.4*sin(uTime*5.)); }
  if(k<=3||(k>=7&&k<=13)) col=seasonal(col,n,vWP.xz,k==1?1.:0.);   // zieleń drzew się przebarwia, śnieg tylko na tym, co stoi
  oC=vec4(col*toon(n)+emis, flag>.5?1.:.5);
  oN=vec4(n*.5+.5,1.);
}`;
const boxP = prog(COMMON + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor;
layout(location=2) in vec4 iA; layout(location=3) in vec4 iB; layout(location=4) in vec4 iC;
out vec3 vNor; out vec3 vLN; out vec3 vCol; out vec3 vLoc; out vec3 vSize; out vec3 vWP; flat out float vKind; flat out float vSeed;
void main(){
  vec3 l=aPos*iB.xyz; float c=cos(iA.w), s=sin(iA.w);
  vec3 r=vec3(l.x*c+l.z*s, l.y, -l.x*s+l.z*c);
  vec3 sn=normalize(aNor/max(iB.xyz,vec3(1e-3)));   // normalna po skalowaniu (połać dachu zależy od proporcji)
  vNor=vec3(sn.x*c+sn.z*s, sn.y, -sn.x*s+sn.z*c);
  vLN=aNor; vCol=iC.rgb; vLoc=l; vSize=iB.xyz; vKind=iB.w; vSeed=iC.w;
  vWP=iA.xyz+r; vWP.y+=demAt(iA.xz); gl_Position=uVP*vec4(vWP,1.);   // cała bryła stoi na terenie w punkcie bazowym
}`,
SOLID_FS);
// ściana: vLoc.x to pozycja wzdłuż ściany, więc ten sam shader rysuje okna
const meshP = prog(COMMON + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec3 aWall; layout(location=3) in vec2 aKS; layout(location=4) in vec3 aCol;
out vec3 vNor; out vec3 vLN; out vec3 vCol; out vec3 vLoc; out vec3 vSize; out vec3 vWP; flat out float vKind; flat out float vSeed;
void main(){
  vWP=aPos; vNor=aNor; vLN=abs(aNor.y)<.5?vec3(0,0,1):vec3(0,1,0); vCol=aCol; vSize=vec3(aWall.y*.1,aWall.z*.1,0.);
  vLoc=vec3(aWall.x*.1-vSize.x*.5,aPos.y,0.); vKind=aKS.x; vSeed=aKS.y;
  vWP.y+=demAt(aPos.xz); gl_Position=uVP*vec4(vWP,1.);
}`, SOLID_FS);
// teren z OSM: płaskie wielokąty, kolor wg klasy
const landP = prog(COMMON + `
layout(location=0) in vec2 aP; layout(location=1) in vec2 aC; out vec2 vW; flat out int vC; flat out float vS;
void main(){ vW=vec2(aP.x,-aP.y); vC=int(aC.x+.5); vS=aC.y; gl_Position=uVP*vec4(aP.x,demAt(aP),aP.y,1.); }`,
COMMON + `
in vec2 vW; flat in int vC; flat in float vS; uniform float uTexel; layout(location=0) out vec4 oC; layout(location=1) out vec4 oN;
void main(){
  vec2 p=vW; float n=vnoise(p/30.)*.6+vnoise(p/9.)*.4; vec3 c;
  if(vC==0) c=mix(vec3(.33,.5,.26),vec3(.4,.53,.3),step(.5,n));
  else if(vC==1){
    float h=fract(vS*.137), a=h*3.1416; vec2 d=vec2(cos(a),sin(a));
    vec3 f= h<.3? vec3(.52,.55,.3) : (h<.55? vec3(.42,.5,.26) : (h<.75? vec3(.6,.5,.33): vec3(.35,.47,.25)));
    c=mix(f,f*.88,uTexel<2.5?step(.5,fract(dot(p,d)/6.)):0.);
  }
  else if(vC==2) c=mix(vec3(.4,.56,.29),vec3(.46,.6,.32),step(.55,n));
  else if(vC==3) c=vec3(.56,.5,.38);
  else if(vC==4) c=mix(vec3(.5,.49,.47),vec3(.45,.44,.43),step(.55,n));
  else if(vC==5) c=mix(vec3(.3,.46,.24),vec3(.42,.52,.28),step(.5,fract(p.x/8.)));
  else if(vC==6) c=mix(vec3(.27,.41,.26),vec3(.6,.6,.57),step(.82,h21(floor(p/5.))));
  else if(vC==7) c=mix(vec3(.36,.56,.27),vec3(.42,.6,.3),step(.55,n));
  else if(vC==8) c=mix(vec3(.15,.28,.17),vec3(.2,.36,.2),step(.5,n));
  else if(vC==9) c=mix(vec3(.28,.42,.23),vec3(.2,.34,.2),step(.55,n));
  else if(vC==10) c=mix(vec3(.29,.43,.37),vec3(.22,.37,.42),step(.55,n));
  else if(vC==11) c=vec3(.82,.74,.54);
  else if(vC==12) c=mix(vec3(.55,.55,.52),vec3(.5,.5,.48),step(.55,n));
  else if(vC==13) c=mix(vec3(.3,.56,.28),vec3(.36,.62,.32),step(.5,fract((p.x+p.y)/12.)));
  else if(vC==14) c=mix(vec3(.66,.33,.24),vec3(.6,.3,.22),step(.6,n));
  else if(vC==15) c=vec3(.4,.39,.4);
  else { float w=step(.8,vnoise(vec2(p.x/26.+uTime*.25,p.y/7.))); c=mix(vec3(.17,.34,.54),vec3(.27,.45,.66),w); }
  if(vC<16) c=seasonal(c,vec3(0,1,0),p,vC==13?0.:.5);   // trawa; murawa boiska zostaje zielona
  vec3 up=demNormal(vec2(vW.x,-vW.y));
  oC=vec4(c*toon(up)*hill(up),1.); oN=vec4(up*.5+.5,1.);
}`);
// --- post-processing: kontury, paleta, dithering, skalowanie bez wygładzania
const postP = prog(`#version 300 es
const vec2 v[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));
void main(){ gl_Position=vec4(v[gl_VertexID],0.,1.); }`,
`#version 300 es
precision highp float;
uniform sampler2D uC; uniform sampler2D uN; uniform sampler2D uD;
uniform int uPs; uniform ivec2 uLow; uniform int uPal; uniform int uDith; uniform int uOut; uniform float uThr;
uniform vec3 uPalette[32]; uniform int uPalN;
uniform float uRain; uniform float uSnowFall; uniform float uFog; uniform float uTime;   // pogoda: opady i mgła nad sceną
out vec4 o;
float bayer(ivec2 p){ int m[16]=int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5); return (float(m[(p.y&3)*4+(p.x&3)])+.5)/16.; }
float dep(ivec2 p){ return texelFetch(uD, clamp(p,ivec2(0),uLow-1), 0).r; }
vec3 nor(ivec2 p){ return texelFetch(uN, clamp(p,ivec2(0),uLow-1), 0).xyz*2.-1.; }
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy)/uPs;
  vec4 c=texelFetch(uC,p,0);
  if(uOut==1){
    float d=dep(p); vec3 n=nor(p);
    float dl=dep(p+ivec2(-1,0)), dr=dep(p+ivec2(1,0)), du=dep(p+ivec2(0,1)), dd=dep(p+ivec2(0,-1));
    float lap=max(dl+dr-2.*d, du+dd-2.*d);
    float e = lap>uThr ? 1. : 0.;
    if(e<1.){
      ivec2 off[4]=ivec2[4](ivec2(1,0),ivec2(-1,0),ivec2(0,1),ivec2(0,-1));
      for(int i=0;i<4;i++){ ivec2 q=p+off[i]; if(dot(n,nor(q))<.6 && dep(q)>d+uThr*.15){ e=max(e,.6); } }
    }
    c.rgb*=mix(1.,.42,e);
  }
  vec2 fp=vec2(p);
  if(uFog>0.) c.rgb=mix(c.rgb,vec3(.62,.64,.68),uFog*(.18+.42*fp.y/float(uLow.y)));
  if(uRain>0.){                                         // krople: pionowe kreski w kolumnach, różna prędkość
    float cx=floor(fp.x/2.), r=fract(sin(cx*12.9898)*43758.5453), sp=95.+r*70.;
    float y=fract((fp.y+uTime*sp+r*400.)/(22.+r*38.));
    if(r<uRain*.55 && y<.2) c.rgb=mix(c.rgb,vec3(.72,.78,.9),.5);
    c.rgb*=1.-.12*uRain;
  }
  if(uSnowFall>0.){                                     // płatki: kwadraty 2×2 dryfujące na boki
    vec2 q=fp+vec2(sin(uTime*.6+fp.y*.02)*5.,uTime*13.), cell=floor(q/7.), f=fract(q/7.);
    float r=fract(sin(dot(cell,vec2(12.9898,78.233)))*43758.5453);
    if(r<uSnowFall*.16 && f.x<.3 && f.y<.3) c.rgb=vec3(.95,.96,1.);
  }
  if(uPal==1 && c.a>.75){
    vec3 x=c.rgb; if(uDith==1) x+=(bayer(p)-.5)*.07;
    float best=1e9; vec3 bc=x;
    for(int i=0;i<32;i++){ if(i>=uPalN) break; vec3 q=uPalette[i]-x; float dd=dot(q*q,vec3(.9,1.2,.8)); if(dd<best){best=dd;bc=uPalette[i];} }
    c.rgb=bc;
  }
  o=vec4(c.rgb,1.);
}`);

// Paleta autorska (32 kolory): noc, ciepłe szarości, zielenie, dachy, szkło, światła
const PALETTE = ['#0f0e17','#1b1d2e','#2a2f4a','#3d4566','#5a6488','#8592b0',
  '#2e2a28','#46403b','#645b52','#8a7e70','#b3a693','#dcd2bf','#f3eee2',
  '#1f3a26','#2f5a33','#46803f','#6aa64c','#9cc964',
  '#4a2420','#7a3428','#a8503a','#cf7f55','#e3b07a',
  '#2c4a6e','#3f6f9e','#79a7d3','#bcd9ee',
  '#c9a24a','#f2d16b','#ffeeaa','#7a5f8c','#b07a6a'];
const palF = new Float32Array(PALETTE.length * 3);
PALETTE.forEach((h, i) => { for (let j = 0; j < 3; j++) palF[i * 3 + j] = parseInt(h.slice(1 + 2 * j, 3 + 2 * j), 16) / 255; });

// geometria sześcianu (y od 0 do 1)
// graniastosłup dachu dwuspadowego: podstawa 1×1 na y=0, kalenica wzdłuż x na y=1 (18 wierzchołków: 2 połacie i 2 szczyty)
function prismGeo() {
  const out = [], V = (p, n) => out.push(...p, ...n);
  for (const sz of [1, -1]) {                       // połać od strony +z i -z
    const n = [0, .5, sz], a = [-.5, 0, .5 * sz], b = [.5, 0, .5 * sz], c = [.5, 1, 0], d = [-.5, 1, 0];
    for (const p of [a, b, c, a, c, d]) V(p, n);
  }
  for (const sx of [1, -1]) for (const p of [[.5 * sx, 0, -.5], [.5 * sx, 0, .5], [.5 * sx, 1, 0]]) V(p, [sx, 0, 0]);
  return new Float32Array(out);
}
function cubeGeo() {
  const F = [[[1,0,0],[0,0,1],[0,1,0]],[[-1,0,0],[0,0,-1],[0,1,0]],[[0,1,0],[1,0,0],[0,0,-1]],[[0,-1,0],[1,0,0],[0,0,1]],[[0,0,1],[-1,0,0],[0,1,0]],[[0,0,-1],[1,0,0],[0,1,0]]];
  const out = [];
  for (const [n, u, v] of F) {
    const c = n.map(x => x * .5), corner = (a, b) => [c[0] + u[0] * a * .5 + v[0] * b * .5, c[1] + u[1] * a * .5 + v[1] * b * .5 + .5, c[2] + u[2] * a * .5 + v[2] * b * .5];
    const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, -1), corner(1, 1), corner(-1, 1)];
    for (const p of q) out.push(...p, ...n);
  }
  return new Float32Array(out);
}


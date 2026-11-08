/* ======================= SAMOLOTY (ADS-B przez proxy.mjs) ======================= */
// Pozycje z /aircraft.json co kilka sekund; między odczytami samolot leci dalej swoim kursem i prędkością.
// Bez proxy (plik, statyczny hosting) samolotów po prostu nie ma.
const AIR = { list: [], at: 0, url: '', timer: null, error: '', ok: false };
let selAir = null;                                   // hex zaznaczonego samolotu
const AIRLINES = { LOT: [.11, .2, .45], RYR: [.07, .2, .55], WZZ: [.78, .1, .5], ENT: [.85, .12, .15], DLH: [.1, .15, .3], BTI: [.2, .5, .35], AUA: [.85, .1, .15], THY: [.8, .1, .12] };
const airColor = a => AIRLINES[(a.flight || '').slice(0, 3)] || [.86, .87, .9];

// wysokość na mapie: prawdziwa byłaby daleko poza kadrem, więc ściśnięta (300 m -> ~50, 10 km -> ~310)
const airY = a => a.gnd || !a.alt ? .2 : 20 + 300 * (1 - Math.exp(-Math.max(0, a.alt) / 3000));
const planeScale = () => cam.half > 3000 ? 4 : cam.half > 1500 ? 2.6 : cam.half > 700 ? 1.7 : 1;

function airUrl() {
  if (live.url) return live.url.replace(/vehicles\.json.*$/, 'aircraft.json');
  return /^https?:$/.test(location.protocol) ? new URL('aircraft.json', location.href).href : '';
}
async function pollAir() {
  clearTimeout(AIR.timer);
  if (modes.air && document.visibilityState !== 'hidden') {
    AIR.url = airUrl();
    if (AIR.url) {
      try {
        const r = await fetch(AIR.url, { cache: 'no-store' });
        const j = r.ok && /json/.test(r.headers.get('content-type') || '') ? await r.json() : null;
        if (j && Array.isArray(j.aircraft)) {
          const now = Date.now(), [lat0, lon0] = D.origin;
          AIR.list = j.aircraft.map(a => ({ ...a, x: (a.lon - lon0) * D.kx, y: (a.lat - lat0) * D.ky, t: now - (a.seen || 0) * 1000 }));
          AIR.at = now; AIR.ok = true; AIR.error = j.error || '';
        } else { AIR.ok = false; AIR.error = 'brak danych o samolotach (proxy.mjs)'; }
      } catch (e) { AIR.ok = false; AIR.error = 'brak połączenia z proxy'; }
    }
  }
  AIR.timer = setTimeout(pollAir, 8000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollAir(); });

// pozycja teraz: ostatni odczyt przesunięty o czas, jaki minął (najwyżej 40 s, potem samolot znika)
function airNow() {
  if (!modes.air || !AIR.list.length || Date.now() - AIR.at > 60000) return [];
  if (Math.abs(simMs() - Date.now()) > 120000) return [];           // przewinięty zegar: pozycje na żywo nie pasują
  const now = Date.now(), out = [];
  for (const a of AIR.list) {
    const dt = Math.min(40, (now - a.t) / 1000); if (dt >= 40) continue;
    const v = (a.gs || 0) / 3.6, tr = (a.track || 0) * Math.PI / 180, dx = Math.sin(tr), dy = Math.cos(tr);
    out.push({ a, x: a.x + dx * v * dt, y: a.y + dy * v * dt, dx, dy, h: airY(a) + (a.vr || 0) * dt * .03 });
  }
  return out;
}
let planes = [];
function fillAircraft(o) {
  planes = airNow();
  const s = planeScale();
  for (const p of planes) {
    if (o > dyn.length - 12 * 6) break;
    const { a, x, y, dx, dy, h } = p, ang = Math.atan2(dy, dx), sel = a.hex === selAir, c = sel ? [1, .85, .35] : [.9, .91, .93], tail = airColor(a);
    const at = (u, v, y0, L, H, W, k, col) => { dyn.set([x + dx * u * s + dy * v * s, y0, -(y + dy * u * s - dx * v * s), ang, L * s, H * s, W * s, k, col[0], col[1], col[2], 0], o); o += 12; };
    at(0, 0, h, 34, 3.8, 3.8, 16, c);                       // kadłub
    at(1, 0, h + .8 * s, 7, .7, 32, 16, c);                 // skrzydła
    at(-15, 0, h + 1.2 * s, 4, .5, 11, 16, c);              // statecznik poziomy
    at(-15, 0, h + 3.8 * s, 5, 6, .6, 16, tail);            // statecznik pionowy w barwach linii
    if (h > 1) { at(0, 0, .25, 34, .05, 3.8, 17, c); at(1, 0, .25, 7, .05, 32, 17, c); }   // cień na ziemi pod samolotem
  }
  return o;
}

// numer lotu nad samolotem (te same plakietki co numery linii nad autobusami)
const airBadgePool = [];
function updateAirBadges() {
  const host = $('#badges'), s = planeScale(); let n = 0;
  for (const p of planes) {
    const [sx, sy] = worldToScreen(p.x, p.h + 7 * s, -p.y);
    if (sx < -40 || sy < -40 || sx > innerWidth + 40 || sy > innerHeight + 40) continue;
    let el = airBadgePool[n]; if (!el) { el = document.createElement('div'); el.className = 'badge air'; host.appendChild(el); airBadgePool.push(el); }
    const txt = p.a.flight || p.a.reg || p.a.hex;
    if (el._t !== txt) { el.textContent = '✈ ' + txt; el._t = txt; }
    el._hex = p.a.hex; el.classList.toggle('sel', p.a.hex === selAir);
    el.style.left = sx + 'px'; el.style.top = sy + 'px'; el.style.display = '';
    n++;
  }
  for (let i = n; i < airBadgePool.length; i++) airBadgePool[i].style.display = 'none';
}
// najbliższy samolot pod kursorem: [odległość w px, hex]
function pickAir(px, py, best) {
  let hex = null;
  for (const p of planes) { const [sx, sy] = worldToScreen(p.x, p.h, -p.y), d = Math.hypot(sx - px, sy - py); if (d < best) { best = d; hex = p.a.hex; } }
  for (const el of airBadgePool) {
    if (el.style.display === 'none') continue;
    const r = el.getBoundingClientRect(), d = Math.hypot(Math.max(r.left - px, 0, px - r.right), Math.max(r.top - py, 0, py - r.bottom));
    if (d < best) { best = d; hex = el._hex; }
  }
  return [best, hex];
}
let followAir = false;
function selectAir(hex) {
  selAir = hex; followAir = false;
  if (hex) { selTrip = -1; selStop = -1; selRoute = -1; follow = false; if (typeof selInfra !== 'undefined') selInfra = null; }
  lastSheet = 0; renderSheet();
}
function airFollowTick(dt) {
  if (!followAir || !selAir) return;
  const p = planes.find(p => p.a.hex === selAir); if (!p) return;
  cam.x = lerp(cam.x, p.x, Math.min(1, dt * 3)); cam.z = lerp(cam.z, -p.y, Math.min(1, dt * 3));
}
function airSheet() {
  const p = planes.find(p => p.a.hex === selAir), a = p ? p.a : AIR.list.find(a => a.hex === selAir);
  if (!a) return `<button class="close" data-act="close">✕</button><h2>✈ Samolot poza zasięgiem</h2><div class="sub">Brak świeżych danych o tym samolocie.</div>`;
  const km = Math.hypot(p ? p.x : a.x, p ? p.y : a.y) / 1000;
  const vr = a.vr > 1 ? `wznosi się ${a.vr.toFixed(1)} m/s` : a.vr < -1 ? `zniża się ${(-a.vr).toFixed(1)} m/s` : 'lot poziomy';
  const row = (k, v) => v ? `<li><span class="grow">${k}</span><span class="mut">${esc(String(v))}</span></li>` : '';
  return `<button class="close" data-act="close">✕</button>
  <h2>✈ ${esc(a.flight || a.reg || a.hex.toUpperCase())}</h2>
  <div class="sub">${esc([a.desc || a.type, a.reg].filter(Boolean).join(' · '))}<br>${a.gnd ? 'na ziemi' : `${(a.alt ?? 0).toLocaleString('pl-PL')} m · ${a.gs ?? '?'} km/h · ${vr}`}</div>
  <div class="btnrow"><button data-act="airfollow" class="${followAir ? 'on' : ''}">${followAir ? 'Śledzę' : 'Śledź'}</button></div>
  <p class="note"><a href="https://globe.adsb.lol/?icao=${encodeURIComponent(a.hex)}" target="_blank" rel="noopener">Trasa lotu na mapie adsb.lol ↗</a></p>
  <ul class="list">${row('Kurs', Math.round(a.track) + '°')}${row('Odległość od Rynku', km.toFixed(1).replace('.', ',') + ' km')}${row('Typ', a.type)}${row('Rejestracja', a.reg)}${row('Squawk', a.sq)}${row('Transponder (ICAO)', a.hex.toUpperCase())}</ul>
  <p class="note">Dane ADS-B: <a href="https://adsb.lol/" target="_blank" rel="noopener">adsb.lol</a> (ODbL). Wysokość lotu na mapie jest ściśnięta.</p>`;
}

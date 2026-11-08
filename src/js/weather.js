/* ======================= POGODA I PORY ROKU ======================= */
// Aktualna pogoda w Rzeszowie z Open-Meteo (bez klucza, CC BY 4.0): panel w lewym górnym rogu,
// opady i mgła na mapie, zachmurzenie w oświetleniu, wschód i zachód słońca, śnieg z grubości pokrywy.
// Pora roku (liście, trawa) idzie za datą symulacji; w ustawieniach można ją wymusić.
const WX = { cur: null, days: {}, last: 0, err: '', timer: null };
const WX_URL = 'https://api.open-meteo.com/v1/forecast?latitude=50.0375&longitude=22.0049&timezone=Europe%2FWarsaw&forecast_days=3'
  + '&current=temperature_2m,apparent_temperature,weather_code,precipitation,cloud_cover,wind_speed_10m,snow_depth,is_day&daily=sunrise,sunset';

// kody WMO -> ikona i opis
function wmo(code) {
  if (code === 0) return ['☀️', 'bezchmurnie'];
  if (code <= 2) return ['🌤️', 'małe zachmurzenie'];
  if (code === 3) return ['☁️', 'pochmurno'];
  if (code === 45 || code === 48) return ['🌫️', 'mgła'];
  if (code >= 51 && code <= 57) return ['🌦️', 'mżawka'];
  if (code >= 61 && code <= 67) return ['🌧️', code >= 66 ? 'marznący deszcz' : code === 65 ? 'ulewa' : 'deszcz'];
  if (code >= 71 && code <= 77) return ['🌨️', code === 75 ? 'śnieżyca' : 'śnieg'];
  if (code >= 80 && code <= 82) return ['🌦️', 'przelotny deszcz'];
  if (code === 85 || code === 86) return ['🌨️', 'przelotny śnieg'];
  if (code >= 95) return ['⛈️', 'burza'];
  return ['🌡️', ''];
}
// odpowiedź Open-Meteo -> stan pogody (czysta funkcja, testowana)
function parseWeather(j) {
  const c = j.current || {}, days = {};
  (j.daily?.time || []).forEach((d, i) => {
    const h = s => { const m = /T(\d\d):(\d\d)/.exec(s || ''); return m ? +m[1] + +m[2] / 60 : null; };
    const rise = h(j.daily.sunrise?.[i]), set = h(j.daily.sunset?.[i]);
    if (rise != null && set != null) days[d.replace(/-/g, '')] = [rise, set];
  });
  return { cur: { temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code ?? -1, precip: c.precipitation ?? 0,
    cloud: c.cloud_cover ?? 0, wind: c.wind_speed_10m ?? 0, snow: c.snow_depth ?? 0, time: c.time || '' }, days };
}
async function fetchWeather() {
  if (opt.wx === 'off') return;
  try {
    const r = await fetch(WX_URL, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status);
    Object.assign(WX, parseWeather(await r.json()), { last: Date.now(), err: '' });
  } catch (e) { WX.err = e.message; }
  renderWeather();
}
function startWeather() { clearInterval(WX.timer); fetchWeather(); WX.timer = setInterval(fetchWeather, 15 * 60 * 1000); }

// pogoda dotyczy chwili obecnej: przy symulacji daleko od teraz efekty gasną
const wxNow = () => opt.wx !== 'off' && WX.cur && Date.now() - WX.last < 3 * 3600e3 && Math.abs(simMs() - Date.now()) < 3 * 3600e3;
function weatherFx() {
  const z = { rain: 0, snowFall: 0, fog: 0, cloud: 0, wet: 0 };
  if (!wxNow()) return z;
  const { code, precip, cloud } = WX.cur, amount = clamp(precip / 2.5, .35, 1);
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) z.rain = code >= 80 || code === 65 ? Math.max(amount, .8) : amount;
  if (code >= 95) z.rain = 1;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) z.snowFall = code === 75 || code === 86 ? 1 : Math.max(amount, .5);
  if (code === 45 || code === 48) z.fog = .85;
  z.cloud = clamp(cloud / 100, 0, 1) * .8;
  z.wet = z.rain > 0 || (precip > 0 && !z.snowFall) ? 1 : 0;
  return z;
}
// pora roku z daty symulacji: przebarwienie liści, zimowa trawa, śnieg (z pokrywy śnieżnej albo wymuszony)
const dayOfYear = w => { const d = new Date(Date.UTC(+w.ymd.slice(0, 4), +w.ymd.slice(4, 6) - 1, +w.ymd.slice(6, 8))); return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5); };
function seasonState(w) {
  const s = { autumn: 0, winter: 0, snow: 0 };
  if (opt.season === 'autumn') return { ...s, autumn: 1 };
  if (opt.season === 'winter') return { ...s, winter: 1, snow: .85 };
  if (opt.season === 'spring' || opt.season === 'summer') return s;
  const d = dayOfYear(w);                       // 258 = 15 IX, 283 = 10 X, 324 = 20 XI, 344 = 10 XII, 59 = 1 III, 90 = 1 IV
  s.autumn = d < 258 ? 0 : d < 283 ? (d - 258) / 25 : d < 324 ? 1 : d < 344 ? 1 - (d - 324) / 20 : 0;
  s.winter = d >= 324 ? Math.min(1, (d - 324) / 20) : d < 59 ? 1 : d < 90 ? 1 - (d - 59) / 31 : 0;
  if (wxNow()) s.snow = Math.max(clamp(WX.cur.snow / .05, 0, 1), weatherFx().snowFall * .4);
  return s;
}
function renderWeather() {
  const el = $('#wx');
  if (opt.wx === 'off' || !WX.cur) { el.hidden = true; return; }
  const c = WX.cur, [icon, txt] = wmo(c.code), far = Math.abs(simMs() - Date.now()) > 3 * 3600e3;
  const t = v => (v == null ? '–' : Math.round(v) + '°');
  el.hidden = false;
  el.innerHTML = `<span class="wxi" aria-hidden="true">${icon}</span><b class="wxt">${t(c.temp)}</b><span class="wxd">${esc(txt)}${txt ? ' · ' : ''}odczuwalna ${t(c.feels)} · wiatr ${Math.round(c.wind)} km/h${c.snow > 0 ? ` · śnieg ${Math.round(c.snow * 100)} cm` : ''}${far ? ' · <i>teraz</i>' : ''}</span>`;
  const today = WX.days[warsaw(Date.now()).ymd], hm = h => `${Math.floor(h)}:${String(Math.round(h % 1 * 60)).padStart(2, '0')}`;
  el.title = `Pogoda w Rzeszowie (Open-Meteo)${today ? `, wschód ${hm(today[0])}, zachód ${hm(today[1])}` : ''}`;
  el.setAttribute('aria-label', `Pogoda: ${t(c.temp)}, ${txt}, wiatr ${Math.round(c.wind)} km/h`);
}

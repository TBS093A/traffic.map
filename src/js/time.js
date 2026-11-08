/* ======================= CZAS (Europa/Warszawa) ======================= */
const tzFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', weekday: 'short', day: 'numeric', month: 'short' });
function warsaw(ms) {
  const p = {}; for (const x of tzFmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  const ymd = p.year + p.month + p.day;
  return { ymd, month: +p.month, sec: (+p.hour) * 3600 + (+p.minute) * 60 + (+p.second) + (ms % 1000) / 1000 };
}
function ymdShift(ymd, days) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + days));
  return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
}
function servicesFor(ymd) {
  if (D.dates[ymd]) return { svs: D.dates[ymd], fallback: false };
  const wd = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay();
  const t = S.dayType[wd === 6 ? 'sat' : wd === 0 ? 'sun' : 'wd'] || Object.values(S.dayType)[0];
  return { svs: t ? t.svs : [], fallback: true };
}
const clock = { base: Date.now(), perf: performance.now(), speed: 1 };
const simMs = () => clock.base + (performance.now() - clock.perf) * clock.speed;
function setSpeed(s) { clock.base = simMs(); clock.perf = performance.now(); clock.speed = s; }


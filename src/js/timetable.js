/* ======================= PEŁNY ROZKŁAD PRZYSTANKU ======================= */
// Klasyczna tabliczka: dla każdej linii i kierunku godziny z minutami odjazdów w wybranym typie dnia.

// odjazdy ze słupków `members` w kursach z usług `svs` -> [{ route, head, deps: [sekundy] }]
function timetableFor(members, svs) {
  const sv = new Set(svs.map(s => D.services.indexOf(s))), blocks = new Map();
  for (const m of members) for (const code of S.stopTrips[m]) {
    const tr = S.trips[Math.floor(code / 256)], k = code % 256;
    if (k === tr.stops.length - 1 || !sv.has(tr.service)) continue;
    const key = tr.route + '|' + tr.head;
    let b = blocks.get(key); if (!b) blocks.set(key, b = { route: tr.route, head: tr.head, deps: [] });
    b.deps.push(tr.times[2 * k + 1]);
  }
  const out = [...blocks.values()];
  for (const b of out) b.deps = [...new Set(b.deps)].sort((a, c) => a - c);
  return out.sort((a, b) => a.route - b.route || plCollatorTT.compare(a.head, b.head));
}
const plCollatorTT = new Intl.Collator('pl');
// godzina -> lista minut (kursy po północy jako 24, 25…)
function byHour(deps) {
  const h = new Map();
  for (const d of deps) { const H = Math.floor(d / 3600); if (!h.has(H)) h.set(H, []); h.get(H).push(Math.floor(d / 60) % 60); }
  return [...h.entries()];
}

const TT = { day: 'today' };
const TT_DAYS = [['today', 'Dziś'], ['wd', 'Dzień roboczy'], ['sat', 'Sobota'], ['sun', 'Niedziela']];
function ttServices(day) {
  if (day === 'today') return servicesFor(warsaw(simMs()).ymd).svs;
  return (S.dayType[day] || { svs: [] }).svs;
}
function renderTimetable() {
  if (selStop < 0) return;
  const grp = S.groups[S.stopGroup[selStop]], members = selSide >= 0 ? [selSide] : grp.members;
  const now = warsaw(simMs()).sec, today = TT.day === 'today';
  const blocks = timetableFor(members, ttServices(TT.day));
  const side = selSide >= 0 ? ` · słupek ${esc(S.side[selSide].plat)} ${esc(sideText(selSide))}` : grp.members.length > 1 ? ' · wszystkie słupki' : '';
  let html = `<div class="sub">${esc(grp.name)}${side}</div><div class="fbar" role="tablist">${TT_DAYS.map(([k, t]) => `<button role="tab" data-tt="${k}" aria-selected="${TT.day === k}" class="${TT.day === k ? 'on' : ''}"${k !== 'today' && !S.dayType[k] ? ' disabled' : ''}>${t}</button>`).join('')}</div>`;
  if (!blocks.length) html += '<p class="note">Tego dnia nic stąd nie odjeżdża.</p>';
  for (const b of blocks) {
    html += `<h4 class="tth">${chip(b.route)} → ${esc(b.head)} <span class="mut">${b.deps.length} odjazdów</span></h4><table class="tt"><tbody>`;
    for (const [H, mins] of byHour(b.deps)) {
      const cur = today && Math.floor(now / 3600) === H;
      html += `<tr class="${cur ? 'now' : ''}"><th scope="row">${String(H % 24).padStart(2, '0')}</th><td>${mins.map(m => `<span class="${today && H * 3600 + m * 60 < now ? 'past' : ''}">${String(m).padStart(2, '0')}</span>`).join(' ')}</td></tr>`;
    }
    html += '</tbody></table>';
  }
  $('#ttBody').innerHTML = html + '<p class="note">Godziny z rozkładu. Opóźnienia na żywo widać na tablicy odjazdów.</p>';
}
function openTimetable() { TT.day = 'today'; renderTimetable(); openOv('ttOv'); const cur = $('#ttBody tr.now'); if (cur) cur.scrollIntoView({ block: 'center' }); }
if (typeof document !== 'undefined') $('#ttBody').addEventListener('click', e => { const b = e.target.closest('[data-tt]'); if (b) { TT.day = b.dataset.tt; renderTimetable(); } });

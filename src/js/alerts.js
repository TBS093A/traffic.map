/* ======================= KOMUNIKATY O UTRUDNIENIACH ======================= */
// GTFS-Realtime Alerts z proxy: objazdy, odwołane kursy, przeniesione przystanki.
// Linie i słupki są wskazane identyfikatorami GTFS, które prep.py zapisuje w route_ids / stop_ids.

function alertsFrom(list) {
  const routeIdx = new Map((D.route_ids || []).map((id, i) => [id, i]));
  return list.map(a => ({
    id: a.id, header: a.header || 'Utrudnienia', description: a.description || '', url: /^https?:\/\//.test(a.url || '') ? a.url : '',
    effect: a.effect || '', periods: a.periods || [],
    routes: new Set((a.routes || []).map(r => routeIdx.get(r)).filter(r => r !== undefined)),
    stops: new Set((a.stops || []).map(s => stopIdx(s)).filter(s => s !== undefined)),
    trips: new Set(a.trips || []),
  }));
}
// komunikat obowiązuje teraz (brak okresów = obowiązuje)
const alertActive = (a, nowSec) => !a.periods.length || a.periods.some(([s, e]) => (!s || s <= nowSec) && (!e || nowSec <= e));
// komunikaty dotyczące linii / kursu / słupków; bez wskazanej linii ani słupka dotyczą całej sieci
function alertsFor({ route = -1, routes = [], trip = null, stops = [] } = {}) {
  if (!live.alerts.length || !liveFresh()) return [];
  const now = simMs() / 1000, rs = new Set(routes); if (route >= 0) rs.add(route);
  return live.alerts.filter(a => alertActive(a, now) && (
    (!a.routes.size && !a.stops.size && !a.trips.size) || [...a.routes].some(r => rs.has(r)) || stops.some(s => a.stops.has(s)) || (trip && a.trips.has(trip))));
}
function alertsHtml(list) {
  if (!list.length) return '';
  return list.slice(0, 4).map(a => `<details class="alert" role="note"><summary>⚠ <b>${esc(a.header)}</b>${a.effect ? ` <span class="mut">${esc(a.effect)}</span>` : ''}</summary>`
    + `${a.routes.size ? `<div>${[...a.routes].map(r => chip(r)).join(' ')}</div>` : ''}${a.description ? `<p>${esc(a.description).replace(/\n/g, '<br>')}</p>` : ''}`
    + `${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Więcej</a>` : ''}</details>`).join('')
    + (list.length > 4 ? `<p class="note">i ${list.length - 4} więcej — <a href="#" data-act="alerts">wszystkie komunikaty</a></p>` : '');
}
// przycisk w górnym panelu: liczba aktywnych komunikatów
function syncAlertsBtn() {
  const now = simMs() / 1000, n = liveFresh() ? live.alerts.filter(a => alertActive(a, now)).length : 0;
  const b = $('#bAlerts'); b.hidden = !n; if (n) b.textContent = `⚠ ${n} ${n === 1 ? 'komunikat' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'komunikaty' : 'komunikatów'}`;
}
function openAlerts() {
  const now = simMs() / 1000, list = live.alerts.filter(a => alertActive(a, now));
  $('#alertsBody').innerHTML = list.length ? alertsHtml(list).replace(/<details /g, '<details open ') : '<p class="note">Brak aktywnych komunikatów.</p>';
  openOv('alertsOv');
}
if (typeof document !== 'undefined') $('#bAlerts').onclick = openAlerts;

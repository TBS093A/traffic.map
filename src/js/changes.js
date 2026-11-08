/* ======================= ZMIANY W ROZKŁADZIE ======================= */
// Porównanie z poprzednią wersją rozkładu wkleja pipeline.py (diff.py) do danych strony: D.changes.
// Przycisk w górnym panelu widać, dopóki ktoś nie obejrzy zmian w danej wersji.
const CHANGES = { data: null };
function loadChanges() {
  const ch = D.changes;
  if (!ch || !(ch.added_routes?.length || ch.removed_routes?.length || ch.changed?.length || ch.added_stops?.length || ch.removed_stops?.length)) return;
  CHANGES.data = ch;
  $('#changesLink').hidden = false;
  if (store.get('changesSeen', '') !== ch.to) $('#bChanges').hidden = false;
}
const routeChip = n => { const i = D.routes.findIndex(r => r.n === n); return i >= 0 ? chip(i) : `<span class="chip" style="background:#8c8c96">${esc(n)}</span>`; };
function openChanges() {
  const ch = CHANGES.data; if (!ch) return;
  store.set('changesSeen', ch.to); $('#bChanges').hidden = true;
  const sec = (title, body) => body ? `<h4 class="tth">${title}</h4>${body}` : '';
  const ymd = s => s && s.length === 8 ? `${s.slice(6)}.${s.slice(4, 6)}.${s.slice(0, 4)}` : s;
  let html = `<p class="sub">Rozkład ${esc(ch.to)}${ch.start ? ', ważny od ' + esc(ymd(ch.start)) : ''}, w porównaniu z ${esc(ch.from)}.</p>`;
  html += sec('Nowe linie', ch.added_routes.length ? `<div class="schips">${ch.added_routes.map(routeChip).join('')}</div>` : '');
  html += sec('Zlikwidowane linie', ch.removed_routes.length ? `<div class="schips">${ch.removed_routes.map(n => `<span class="chip" style="background:#8c8c96">${esc(n)}</span>`).join('')}</div>` : '');
  html += sec('Zmiany w liniach', ch.changed.length ? `<ul class="list">${ch.changed.map(c => `<li class="leg"><span>${routeChip(c.route)}</span><span class="grow">${c.notes.map(esc).join('<br>')}</span></li>`).join('')}</ul>` : '');
  html += sec('Nowe przystanki', ch.added_stops.length ? `<p>${ch.added_stops.map(esc).join(', ')}</p>` : '');
  html += sec('Zlikwidowane przystanki', ch.removed_stops.length ? `<p>${ch.removed_stops.map(esc).join(', ')}</p>` : '');
  $('#changesBody').innerHTML = html + '<p class="note">Porównanie liczby kursów, taktu w szczycie (dni robocze 7–9), pierwszego i ostatniego kursu oraz przystanków każdej linii.</p>';
  $('#setOv').classList.remove('show'); openOv('changesOv');
}
if (typeof document !== 'undefined') { $('#bChanges').onclick = openChanges; $('#changesLink').onclick = e => { e.preventDefault(); openChanges(); }; }

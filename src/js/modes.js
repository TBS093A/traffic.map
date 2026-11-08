/* ======================= TRYBY: autobusy, pociągi, samoloty, infrastruktura ======================= */
// Użytkownik sam wybiera, co widać na mapie; wybór jest zapamiętany i trafia do udostępnianego linku.
const MODES = [['bus', '🚌', 'Autobusy'], ['rail', '🚆', 'Pociągi'], ['air', '✈', 'Samoloty'], ['infra', '🗼', 'Infrastruktura']];
const MODE_DEFAULT = { bus: true, rail: true, air: true, infra: false };
const modes = Object.assign({}, MODE_DEFAULT, store.get('modes', {}));
let modesVer = 0;                         // rośnie przy każdej zmianie: przystanki i podpisy się przebudowują

const routeIsRail = r => D.routes[r].m === 1;
const routeOn = r => modes[routeIsRail(r) ? 'rail' : 'bus'];
const stopIsRail = m => D.stops[m][5] === 1;
const stopOn = m => modes[stopIsRail(m) ? 'rail' : 'bus'];
const groupOn = g => modes[g.rail ? 'rail' : 'bus'];
const hasRail = () => D.routes.some(r => r.m === 1);

// litery w linku: b = autobusy, r = pociągi, a = samoloty, i = infrastruktura
const modesCode = () => MODES.filter(([k]) => modes[k]).map(([k]) => k[0]).join('') || '-';
const modesFromCode = s => Object.fromEntries(MODES.map(([k]) => [k, String(s).includes(k[0])]));

function setModes(next) {
  let changed = false;
  for (const [k] of MODES) if (k in next && modes[k] !== !!next[k]) { modes[k] = !!next[k]; changed = true; }
  if (!changed) return;
  store.set('modes', modes); modesVer++;
  if (typeof stopScale !== 'undefined') stopScale = 0;          // przystanki i stacje: przebudowa przy następnej klatce
  if (selTrip >= 0 && !routeOn(S.trips[selTrip].route)) select({ route: -1 });
  else if (selRoute >= 0 && !routeOn(selRoute)) select({ route: -1 });
  else if (selStop >= 0 && !stopOn(selStop)) select({ route: -1 });
  if (!modes.air && typeof selAir !== 'undefined' && selAir) selectAir(null);
  if (!modes.infra && typeof selInfra !== 'undefined' && selInfra) selectInfra(null);
  syncModeBtns();
}
function syncModeBtns() {
  const host = $('#modes'); if (!host) return;
  if (!host.childElementCount) host.innerHTML = MODES.map(([k, ic, name]) => `<button data-mode="${k}" title="${name}" aria-label="${name}">${ic}</button>`).join('');
  host.querySelectorAll('[data-mode]').forEach(b => {
    const k = b.dataset.mode, off = k === 'rail' && !hasRail();
    b.hidden = off; b.classList.toggle('on', modes[k]); b.setAttribute('aria-pressed', String(modes[k]));
  });
}
function initModes() {
  syncModeBtns();
  $('#modes').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setModes({ [b.dataset.mode]: !modes[b.dataset.mode] }); });
}

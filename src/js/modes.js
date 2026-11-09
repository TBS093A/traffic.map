/* ======================= TRYBY ======================= */
// Tryb (zakładki u góry: autobusy, pociągi, samoloty, infrastruktura) zmienia interfejs: narzędzia po prawej,
// listy, szukajkę i planer. Mapa rysuje wszystko niezależnie od trybu; co widać na mapie, ustawia się osobno
// w ustawieniach („Na mapie”, warstwy).
const MODES = [['bus', '🚌', 'Autobusy'], ['rail', '🚆', 'Pociągi'], ['air', '✈', 'Samoloty'], ['infra', '🗼', 'Infrastruktura']];
const MODE_KEYS = MODES.map(m => m[0]);
const LAYER_DEFAULT = { bus: true, rail: true, air: true, infra: true };
const modes = Object.assign({}, LAYER_DEFAULT, store.get('layers', {}));   // warstwy widoczne na mapie
let uiMode = MODE_KEYS.includes(store.get('mode', 'bus')) ? store.get('mode', 'bus') : 'bus';
let modesVer = 0;                         // rośnie przy każdej zmianie warstw: przystanki i podpisy się przebudowują

const routeIsRail = r => D.routes[r].m === 1;
const routeOn = r => modes[routeIsRail(r) ? 'rail' : 'bus'];
const stopIsRail = m => D.stops[m][5] === 1;
const stopOn = m => modes[stopIsRail(m) ? 'rail' : 'bus'];
const groupOn = g => modes[g.rail ? 'rail' : 'bus'];
const hasRail = () => D.routes.some(r => r.m === 1);
// planer: w trybie autobusów same autobusy, w trybie pociągów autobusy i pociągi (przesiadki)
const planRouteOk = r => routeOn(r) && (uiMode !== 'bus' || !routeIsRail(r));
// lista w trybie: linie autobusowe albo kategorie pociągów; przystanki albo stacje
const routeInMode = r => uiMode === 'rail' ? routeIsRail(r) : !routeIsRail(r);
const groupInMode = g => uiMode === 'rail' ? !!g.rail : !g.rail;

// litery w linku: b = autobusy, r = pociągi, a = samoloty, i = infrastruktura
const modesCode = () => MODE_KEYS.filter(k => modes[k]).map(k => k[0]).join('') || '-';
const modesFromCode = s => Object.fromEntries(MODE_KEYS.map(k => [k, String(s).includes(k[0])]));

function setModes(next) {
  let changed = false;
  for (const k of MODE_KEYS) if (k in next && modes[k] !== !!next[k]) { modes[k] = !!next[k]; changed = true; }
  if (!changed) return;
  store.set('layers', modes); modesVer++;
  if (typeof stopScale !== 'undefined') stopScale = 0;          // przystanki i stacje: przebudowa przy następnej klatce
  if (selTrip >= 0 && !routeOn(S.trips[selTrip].route)) select({ route: -1 });
  else if (selRoute >= 0 && !routeOn(selRoute)) select({ route: -1 });
  else if (selStop >= 0 && !stopOn(selStop)) select({ route: -1 });
  if (!modes.air && selAir) select({ route: -1 });
  if (!modes.infra && selInfra !== null) select({ route: -1 });
  syncLayerBtns();
}
function syncLayerBtns() {
  const host = $('#layers'); if (!host) return;
  if (!host.childElementCount) host.innerHTML = MODES.map(([k, ic, name]) => `<button data-layer="${k}" aria-label="${name} na mapie">${ic} ${name}</button>`).join('');
  host.querySelectorAll('[data-layer]').forEach(b => {
    const k = b.dataset.layer; b.hidden = k === 'rail' && !hasRail();
    b.classList.toggle('on', modes[k]); b.setAttribute('aria-pressed', String(modes[k]));
  });
}

// quiet: zmiana z zaznaczenia na mapie (np. kliknięty pociąg) — bez zamykania okien i czyszczenia zaznaczenia
function setUiMode(k, quiet = false) {
  if (!MODE_KEYS.includes(k)) return;
  const changed = k !== uiMode;
  uiMode = k; store.set('mode', k); document.body.dataset.mode = k;
  if (!modes[k]) setModes({ [k]: true });                       // tryb bez swojej warstwy na mapie nie ma sensu
  syncModeBar();
  if (!changed || quiet) return;
  document.querySelectorAll('.overlay.show').forEach(o => o.classList.remove('show'));
  if (plan.sel >= 0 && k !== 'bus' && k !== 'rail') plan.sel = -1;
  select({ route: -1 });
}
const modeOfTrip = ti => routeIsRail(S.trips[ti].route) ? 'rail' : 'bus';
function syncModeBar() {
  const bar = $('#modebar'); if (!bar) return;
  if (!bar.childElementCount) bar.innerHTML = MODES.map(([k, ic, name], i) => `<button role="tab" data-mode="${k}" title="${name} (${i + 1})"><span aria-hidden="true">${ic}</span><b>${name}</b></button>`).join('');
  bar.querySelectorAll('[data-mode]').forEach(b => {
    const k = b.dataset.mode, on = k === uiMode;
    b.hidden = k === 'rail' && !hasRail();
    b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
  });
}
function initModes() {
  document.body.dataset.mode = uiMode;
  syncModeBar(); syncLayerBtns();
  $('#modebar').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setUiMode(b.dataset.mode); });
  $('#layers').addEventListener('click', e => { const b = e.target.closest('[data-layer]'); if (b) setModes({ [b.dataset.layer]: !modes[b.dataset.layer] }); });
}

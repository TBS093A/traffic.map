/* ======================= PRZYPOMNIENIE „WYJDŹ Z DOMU” ======================= */
// Dla wybranego wariantu planera: powiadomienie X minut przed wyjściem. Czas wyjścia przesuwa się
// razem z opóźnieniem pierwszego autobusu (dane na żywo). Strona musi być otwarta (bez serwera push).
const REMIND = { list: [], lead: store.get('remindLead', 5) };

// czas wyjścia z domu [s doby] dla wariantu: odjazd pierwszego autobusu (z opóźnieniem) minus dojście
function leaveTime(o) {
  const i = o.legs.findIndex(l => l.type === 'ride');
  if (i < 0) return o.dep;
  const L = o.legs[i], tr = S.trips[L.ti], walkBefore = o.legs.slice(0, i).reduce((a, l) => a + (l.type === 'walk' ? l.dur : 0), 0);
  return L.dep + (liveDelay(tr, L.from) ?? 0) - walkBefore;
}
const remindKey = o => o.legs.map(l => l.type === 'ride' ? l.ti : 'w').join('-') + '@' + o.dep;
const reminderFor = o => REMIND.list.find(r => r.key === remindKey(o));

function remindHtml(o) {
  if (o.rides === 0) return '';
  const r = reminderFor(o);
  return `<div class="fbar remind" role="group" aria-label="Przypomnienie przed wyjściem"><span class="mut">⏰ Przypomnij</span>${[5, 10, 15].map(m =>
    `<button data-remind="${m}" aria-pressed="${!!r && r.lead === m}" class="${r && r.lead === m ? 'on' : ''}">${m} min</button>`).join('')}<span class="mut">przed wyjściem</span></div>`
    + (r ? `<p class="note">Wyjście o ${fmtT(leaveTime(o))}. Przypomnienie o ${fmtT(leaveTime(o) - r.lead * 60)}, gdy strona jest otwarta.</p>` : '');
}
async function toggleReminder(o, lead) {
  const r = reminderFor(o);
  REMIND.list = REMIND.list.filter(x => x !== r);
  if (!r || r.lead !== lead) {
    REMIND.list.push({ key: remindKey(o), o, lead, label: plan.fromP.label + ' → ' + plan.toP.label });
    REMIND.lead = lead; store.set('remindLead', lead);
    try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch (e) { /* bez zgody: zostaje komunikat na stronie */ }
    toastFor(`Przypomnę ${lead} min przed wyjściem (${fmtT(leaveTime(o) - lead * 60)})`);
  } else toastFor('Przypomnienie wyłączone');
  lastSheet = 0; renderSheet();
}
function fireReminder(r) {
  const leave = leaveTime(r.o), first = r.o.legs.find(l => l.type === 'ride');
  const body = `Wyjdź o ${fmtT(leave)}: linia ${D.routes[first.route].n} z ${D.stops[first.fromStop][2]} o ${fmtT(first.dep + (liveDelay(S.trips[first.ti], first.from) ?? 0))}`;
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Czas wychodzić · ' + r.label, { body, icon: 'icon-192.png', tag: r.key }); } catch (e) { /* np. Android bez service workera */ }
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { /* brak wibracji */ }
  toastFor('⏰ ' + body, 15000);
}
// wywoływane z pętli UI: odpala przypomnienia, których czas minął (według zegara symulacji)
function checkReminders(nowSec) {
  for (const r of [...REMIND.list]) {
    if (nowSec >= leaveTime(r.o) - r.lead * 60) { REMIND.list = REMIND.list.filter(x => x !== r); fireReminder(r); lastSheet = 0; }
  }
}

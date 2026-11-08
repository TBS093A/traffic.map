/* ======================= AUTOMATYCZNA JAKOŚĆ ======================= */
// Na słabszym sprzęcie (telefon, zintegrowana grafika) strona sama upraszcza obraz, gdy klatki są za wolne:
// najpierw mniej szczegółów (LOD budynków i drzew), potem większy piksel. Gdy jest zapas, wraca do pełnej jakości.
const PERF = { ema: 16, lod: 0, boost: 0, t: 0, good: 0, fps: 60 };
const PERF_SLOW = 42, PERF_FAST = 22;          // ms na klatkę: poniżej ok. 24 kl./s upraszczamy, powyżej ok. 45 wracamy

function perfTick(dtSec, now) {
  const ms = dtSec * 1000;
  if (ms <= 0 || ms >= 100) return;                 // pauza karty, przełączenie okna: nie liczymy
  PERF.ema += (ms - PERF.ema) * .05; PERF.fps = Math.round(1000 / PERF.ema);
  if (!opt.auto || now - PERF.t < 2000) return;
  PERF.t = now;
  if (PERF.ema > PERF_SLOW) {
    PERF.good = 0;
    if (PERF.lod < 1) PERF.lod++; else if (PERF.boost < 2) PERF.boost++;
    else return;
    syncPerfNote();
  } else if (PERF.ema < PERF_FAST && (PERF.lod || PERF.boost)) {
    if (++PERF.good < 3) return;                    // 6 s zapasu, zanim podniesiemy jakość (bez migotania)
    PERF.good = 0;
    if (PERF.boost) PERF.boost--; else PERF.lod--;
    syncPerfNote();
  } else PERF.good = 0;
}
const perfPixel = () => opt.auto ? PERF.boost : 0;
const perfLod = () => opt.auto ? PERF.lod : 0;
function syncPerfNote() {
  const el = $('#perfNote'); if (!el) return;
  el.textContent = !opt.auto ? 'Jakość stała.' : (PERF.lod || PERF.boost)
    ? `Jakość obniżona automatycznie (ok. ${PERF.fps} kl./s): ${PERF.lod ? 'mniej szczegółów' : ''}${PERF.lod && PERF.boost ? ', ' : ''}${PERF.boost ? 'piksel +' + PERF.boost : ''}.`
    : `Pełna jakość (ok. ${PERF.fps} kl./s).`;
}

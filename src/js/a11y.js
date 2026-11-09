/* ======================= DOSTĘPNOŚĆ: KLAWIATURA I CZYTNIKI EKRANU ======================= */
// Mapa jest grafiką WebGL, więc wszystko, co da się na niej zrobić, ma też tekstową drogę:
// szukajka, listy linii i przystanków, tablice odjazdów i planer. Ten moduł dba, żeby te drogi
// działały z klawiatury i czytnika ekranu.

// klikalne elementy list (wiersze, numery linii, podpowiedzi) jako przyciski
const CLICKABLE = 'li[data-trip],li[data-stop],li[data-g],li[data-o],li[data-fi],li[data-air],li[data-inf],.chip[data-r],.sug [data-pi],.sug [data-act]';
function enhance(root) {
  for (const el of root.querySelectorAll(CLICKABLE)) {
    if (el.tabIndex < 0 || !el.hasAttribute('tabindex')) el.tabIndex = 0;
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    if (el.classList.contains('chip') && !el.hasAttribute('aria-label') && el.title) el.setAttribute('aria-label', `Linia ${el.textContent}: ${el.title}`);
  }
}
function setupA11y() {
  const canvas = $('#c');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Mapa Rzeszowa z autobusami, pociągami, samolotami i infrastrukturą. Tryb wybierasz zakładkami u góry (klawisze 1–4); listy, szukajka i planer są w przyciskach po prawej i pod klawiszami: / szukaj, L lista, P planer.');
  for (const b of document.querySelectorAll('button[title]')) if (!b.hasAttribute('aria-label')) b.setAttribute('aria-label', b.title);
  $('#sheet').setAttribute('role', 'region'); $('#sheet').setAttribute('aria-label', 'Szczegóły');
  $('#toast').setAttribute('role', 'status'); $('#toast').setAttribute('aria-live', 'polite');
  $('#tools').setAttribute('role', 'toolbar'); $('#tools').setAttribute('aria-label', 'Narzędzia');
  $('#nav').setAttribute('role', 'toolbar'); $('#nav').setAttribute('aria-label', 'Widok mapy');
  $('#speeds').setAttribute('role', 'group'); $('#speeds').setAttribute('aria-label', 'Tempo symulacji');
  $('#clock').setAttribute('aria-label', 'Godzina symulacji');
  // pola formularzy: etykiety dla czytnika (placeholder nie jest etykietą), „Skąd”/„Dokąd” powiązane z polami
  const LABELS = { q: 'Szukaj linii albo przystanku', sq: 'Filtruj przystanki', pTime: 'Godzina wyjazdu', setTime: 'Ustaw godzinę symulacji', liveUrl: 'Adres serwera z danymi na żywo' };
  for (const [id, text] of Object.entries(LABELS)) { const el = document.getElementById(id); if (el && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', text); }
  for (const pf of document.querySelectorAll('.pf')) { const l = pf.querySelector('label'), i = pf.querySelector('input'); if (l && i) l.htmlFor = i.id; }
  for (const ov of document.querySelectorAll('.overlay')) {
    const h = ov.querySelector('h3'), p = ov.querySelector('.panel');
    if (h && !h.id) h.id = ov.id + 'Title';
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true'); if (h) p.setAttribute('aria-labelledby', h.id);
    ov.querySelectorAll('[data-close]').forEach(b => b.setAttribute('aria-label', 'Zamknij'));
    new MutationObserver(() => dialogToggled(ov)).observe(ov, { attributes: true, attributeFilter: ['class'] });
  }
  $('#sheet .close') && $('#sheet .close').setAttribute('aria-label', 'Zamknij');
  // nowe wiersze (tablice odjazdów, wyniki szukania) od razu dostają obsługę klawiatury
  new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { enhance(n.parentNode || n); if (n.matches && n.matches('.close')) n.setAttribute('aria-label', 'Zamknij'); } })
    .observe(document.body, { childList: true, subtree: true });
  enhance(document.body);
}
// okno dialogowe: fokus do środka po otwarciu, z powrotem po zamknięciu, Tab nie ucieka na mapę
const dialogFocus = new Map();
function dialogToggled(ov) {
  const open = ov.classList.contains('show');
  if (open && !dialogFocus.has(ov)) {
    dialogFocus.set(ov, document.activeElement);
    setTimeout(() => { if (!ov.contains(document.activeElement)) (ov.querySelector('input,[tabindex="0"],button:not([data-close])') || ov.querySelector('button'))?.focus(); }, 40);
  } else if (!open && dialogFocus.has(ov)) {
    const prev = dialogFocus.get(ov); dialogFocus.delete(ov);
    if (prev && document.contains(prev)) prev.focus();
  }
}
const openDialog = () => [...document.querySelectorAll('.overlay.show')].pop();
addEventListener('keydown', e => {
  const ov = openDialog();
  if (e.key === 'Escape' && ov) { ov.classList.remove('show'); e.stopImmediatePropagation(); e.preventDefault(); return; }
  if (e.key === 'Tab' && ov) {                       // pułapka fokusu w otwartym oknie
    const f = [...ov.querySelectorAll('button:not([disabled]),input,a[href],[tabindex="0"],summary')].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    return;
  }
  // Enter / spacja na wierszu listy działa jak kliknięcie
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role=button]:not(button)')) { e.preventDefault(); e.stopImmediatePropagation(); e.target.click(); }
}, true);

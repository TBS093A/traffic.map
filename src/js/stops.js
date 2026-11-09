/* ======================= GRUPY PRZYSTANKÓW ======================= */
// słupki o tej samej nazwie (bez numeru) w promieniu 600 m to jeden przystanek
function buildStopGroups() {
  S.groups = []; S.stopGroup = new Int32Array(D.stops.length);
  const byName = new Map();
  D.stops.forEach(([x, y, name, , , mode], i) => {
    const rail = mode === 1, base = rail ? name : name.replace(/\s+\d+\S*(\s+nż)?$/, '').trim() || name;   // stacja: perony mają jedną nazwę
    const key = (rail ? 'R|' : '') + base, list = byName.get(key) || []; byName.set(key, list);
    let g = list.find(g => Math.hypot(D.stops[g.members[0]][0] - x, D.stops[g.members[0]][1] - y) < 600);
    if (!g) { g = { name: base, n: norm(base), members: [], x: 0, y: 0, routes: new Set(), trips: 0, id: S.groups.length, rail }; list.push(g); S.groups.push(g); }
    g.members.push(i); S.stopGroup[i] = g.id;
  });
  for (const g of S.groups) {
    for (const m of g.members) { g.x += D.stops[m][0] / g.members.length; g.y += D.stops[m][1] / g.members.length;
      for (const code of S.stopTrips[m]) { g.routes.add(S.trips[Math.floor(code / 256)].route); g.trips++; } }
    g.routeList = [...g.routes].sort((a, b) => a - b);
  }
}

/* ======================= STRONY RUCHU (KIERUNKI SŁUPKÓW) ======================= */
const platOf = (m, g) => D.stops[m][2].slice(g.name.length).trim() || D.stops[m][3] || '';
function buildStopSides() {
  S.side = D.stops.map(() => null);
  const top = map => [...map.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  for (const g of S.groups) for (const m of g.members) {
    const heads = new Map(), next = new Map(), routes = new Set(); let n = 0;
    for (const code of S.stopTrips[m]) {
      const tr = S.trips[Math.floor(code / 256)], k = code % 256;
      if (k === tr.stops.length - 1) continue;
      n++; routes.add(tr.route);
      heads.set(tr.head, (heads.get(tr.head) || 0) + 1);
      const nx = S.groups[S.stopGroup[tr.stops[k + 1]]].name; next.set(nx, (next.get(nx) || 0) + 1);
    }
    S.side[m] = { plat: platOf(m, g), allHeads: top(heads), heads: [], next: top(next)[0] || '', deps: n, routes: [...routes].sort((a, b) => a - b), arrOnly: n === 0 };
  }
  // pokazuj tylko kierunki, które odróżniają słupki (np. linie okrężne jadą „na Dworzec” z obu stron)
  for (const g of S.groups) {
    const sides = g.members.map(m => S.side[m]);
    const common = sides.length > 1 ? sides.reduce((acc, sd) => acc === null ? new Set(sd.allHeads) : new Set([...acc].filter(h => sd.allHeads.includes(h))), null) : new Set();
    for (const sd of sides) {
      sd.heads = sd.allHeads.filter(h => !common.has(h)).slice(0, 2);
      if (!sd.heads.length && sd.next) sd.heads = ['przez ' + sd.next];
      else if (!sd.heads.length) sd.heads = sd.allHeads.slice(0, 2);
    }
  }
}
const stopIcon = g => g.rail ? '🚉' : '🚏';
const sideText = m => { const s = S.side[m]; return s.arrOnly ? 'tylko wysiadka' : '→ ' + s.heads.join(' / '); };
const miniChips = (routes, max) => `<span class="mini">${routes.slice(0, max).map(r => `<i style="background:${rgbCss(D.routes[r].c)}">${esc(D.routes[r].n)}</i>`).join('')}${routes.length > max ? '<i class="more">+' + (routes.length - max) + '</i>' : ''}</span>`;
function groupRowsHtml(g) {
  let h = `<li data-g="${g.id}" class="grp"><span class="grow">${stopIcon(g)} ${esc(g.name)}</span>${miniChips(g.routeList, 7)}</li>`;
  if (g.members.length > 1) for (const m of g.members) {
    const sd = S.side[m];
    h += `<li data-g="${g.id}" data-m="${m}" class="side"><span class="pl">${esc(sd.plat)}</span><span class="grow">${esc(sideText(m))}${sd.next && !sd.arrOnly ? `<br><span class="mut">następny: ${esc(sd.next)}</span>` : ''}</span>${miniChips(sd.routes, 5)}</li>`;
  }
  return h;
}

/* ======================= SZUKAJKA ======================= */
// szuka w bieżącym trybie: autobusy (linie, przystanki) albo pociągi (kategorie, numery i nazwy pociągów, stacje)
const inMode = (fn, fallback) => typeof uiMode === 'undefined' ? fallback : fn();
function doSearch(qRaw) {
  const n = norm(qRaw.trim()), rail = inMode(() => uiMode === 'rail', false);
  const lines = D.routes.map((r, i) => ({ r, i })).filter(({ r }) => (r.m === 1) === rail && (!n || r.n.toLowerCase().startsWith(n) || norm(r.name || '').includes(n)));
  let stops = [], trains = [];
  if (n.length >= 2) stops = S.groups.filter(g => !!g.rail === rail && g.n.includes(n) && g.trips > 0).sort((a, b) => (b.n.startsWith(n) - a.n.startsWith(n)) || (b.trips - a.trips)).slice(0, 40);
  if (rail && n.length >= 2) {                  // pociągi po numerze, nazwie albo kierunku; jeden wiersz na pociąg
    const seen = new Set();
    for (let ti = 0; ti < S.trips.length && trains.length < 30; ti++) {
      const tr = S.trips[ti]; if (!routeIsRail(tr.route)) continue;
      const key = tr.brig + '|' + tr.head; if (seen.has(key) || !(norm(tr.brig || '').includes(n) || norm(tr.head).includes(n))) continue;
      seen.add(key); trains.push(ti);
    }
  }
  const lh = lines.length ? `<div class="schips">${lines.map(({ r, i }) => `<span class="chip" data-r="${i}" style="background:${rgbCss(r.c)}" title="${esc(r.name)}">${esc(r.n)}</span>`).join('')}</div>` : '<p class="note">Brak linii.</p>';
  const what = rail ? 'stacji' : 'przystanków';
  const sh = n.length < 2 ? `<p class="note">Wpisz co najmniej 2 znaki, żeby szukać ${rail ? 'stacji i pociągów' : 'przystanków'}.</p>`
    : stops.length ? `<ul class="list">${stops.map(g => groupRowsHtml(g)).join('')}</ul>` : `<p class="note">Brak ${what}.</p>`;
  const th = rail && n.length >= 2 ? `<h4>Pociągi <span>${trains.length}</span></h4><ul class="list">${trains.map(ti => { const tr = S.trips[ti];
    return `<li data-trip="${ti}">${chip(tr.route)}<span class="grow"><b>${esc(tr.brig || '')}</b> → ${esc(tr.head)}</span><span class="mut">${fmtT(tr.start)}</span></li>`; }).join('') || '<li class="past">Brak pociągów.</li>'}</ul>` : '';
  $('#results').innerHTML = `<h4>${rail ? 'Kategorie' : 'Linie'} <span>${lines.length}</span></h4>${lh}${th}<h4>${rail ? 'Stacje' : 'Przystanki'} <span>${n.length < 2 ? '' : stops.length}</span></h4>${sh}`;
}
function openSearch() { openOv('searchOv'); const q = $('#q'); doSearch(q.value); setTimeout(() => { q.focus(); q.select(); }, 30); }

/* ======================= LISTA PRZYSTANKÓW ======================= */
const plCollator = new Intl.Collator('pl');
function renderStopList(qRaw) {
  const n = norm(qRaw.trim());
  const rail = inMode(() => uiMode === 'rail', false);
  $('#stopsTitle').textContent = rail ? 'Stacje' : 'Przystanki';
  $('#sq').placeholder = rail ? 'filtruj stacje…' : 'filtruj przystanki…';
  const list = S.groups.filter(g => !!g.rail === rail && g.trips > 0 && (!n || g.n.includes(n))).sort((a, b) => plCollator.compare(a.name, b.name));
  let html = '', letter = '';
  for (const g of list) {
    const L = g.name[0].toUpperCase();
    if (L !== letter && !n) { letter = L; html += `<li class="letter">${esc(L)}</li>`; }
    html += groupRowsHtml(g);
  }
  $('#stopList').innerHTML = `<p class="note">${list.length} ${rail ? 'stacji · każda rozbita na perony i tory' : 'przystanków · każdy rozbity na strony ruchu (słupki)'}</p><ul class="list">${html}</ul>`;
}
function focusGroup(gid, zoom = 320) {
  const g = S.groups[gid]; select({ stop: g.members[0], route: -1, side: -1 });
  cam.x = g.x; cam.z = -g.y; cam.half = Math.min(cam.half, zoom); follow = false;
}
function focusMember(m, zoom = 220) {
  select({ stop: m, route: -1, side: m });
  cam.x = D.stops[m][0]; cam.z = -D.stops[m][1]; cam.half = Math.min(cam.half, zoom); follow = false;
}
function listClick(e, ov) {
  const li = e.target.closest('[data-g]'); if (!li) return false;
  if (li.dataset.m !== undefined) focusMember(+li.dataset.m); else focusGroup(+li.dataset.g);
  $('#' + ov).classList.remove('show'); return true;
}


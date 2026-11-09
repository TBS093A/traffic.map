/* ======================= LINKI DO WIDOKU ======================= */
// Stan widoku w części # adresu, np.  #s=Rejtana&v=120,-340,1,400  albo  #from=s:Rynek&to=p:50.03,22.01,Dom&at=07:30
// Przystanki i linie są zapisane nazwami, nie indeksami, więc link przeżywa przebudowę rozkładu.
//   v     kamera: x,z,obrót (0–3, co 90°),pół-wysokość kadru [m]
//   s     przystanek (nazwa grupy), side: słupek (oznaczenie, np. 02)
//   l     linia (numer), t: kurs (trip_id)
//   from, to   miejsca planera: s:<przystanek> | p:<lat>,<lon>,<opis> | u:<ulica>;  at: godzina wyszukiwania
//   time  godzina symulacji (HH:MM), speed: tempo
//   mode  tryb interfejsu: bus | rail | air | infra
//   m     warstwy widoczne na mapie: b autobusy, r pociągi, a samoloty, i infrastruktura ("-" = nic)
const toLatLon = (x, y) => [D.origin[0] + y / D.ky, D.origin[1] + x / D.kx];
const fromLatLon = (lat, lon) => [(lon - D.origin[1]) * D.kx, (lat - D.origin[0]) * D.ky];

function encodePlace(p) {
  if (!p) return null;
  if (p.kind === 'stop') return 's:' + S.groups[p.g].name;
  if (p.kind === 'point') { const [la, lo] = toLatLon(p.x, p.y); return `p:${la.toFixed(5)},${lo.toFixed(5)},${p.label || ''}`; }
  if (p.kind === 'area') return 'u:' + p.label;
  return null;
}
function decodePlace(s) {
  if (!s) return null;
  const kind = s.slice(0, 2), v = s.slice(2);
  if (kind === 's:') { const g = groupByName(v); return g ? { kind: 'stop', g: g.id, label: g.name, icon: stopIcon(g) } : null; }
  if (kind === 'p:') {
    const [la, lo, ...rest] = v.split(','); const lat = parseFloat(la), lon = parseFloat(lo);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    const [x, y] = fromLatLon(lat, lon); return { kind: 'point', x, y, label: rest.join(',') || 'Punkt na mapie', icon: '📌' };
  }
  if (kind === 'u:') { const a = geocode(v).find(p => p.kind === 'area'); return a || null; }
  return null;
}
function groupByName(name) {
  const n = norm(name); let best = null;
  for (const g of S.groups) if (g.n === n && (!best || g.trips > best.trips)) best = g;
  return best;
}

// stan -> tekst po #; pomija puste pola
function encodeLink(st) {
  const q = new URLSearchParams();
  if (st.cam) q.set('v', [Math.round(st.cam.x), Math.round(st.cam.z), ((Math.round(st.cam.yaw / (Math.PI / 2) - .5) % 4) + 4) % 4, Math.round(st.cam.half)].join(','));
  if (st.stop >= 0) { q.set('s', S.groups[S.stopGroup[st.stop]].name); if (st.side >= 0 && S.side && S.side[st.side].plat) q.set('side', S.side[st.side].plat); }
  if (st.route >= 0) q.set('l', D.routes[st.route].n);
  if (st.trip >= 0) q.set('t', S.trips[st.trip].id);
  const f = encodePlace(st.from), t = encodePlace(st.to);
  if (f && t) { q.set('from', f); q.set('to', t); if (st.at != null) q.set('at', fmtT(st.at)); }
  if (st.time != null) q.set('time', fmtT(st.time));
  if (st.speed != null && st.speed !== 1) q.set('speed', st.speed);
  if (st.mode && st.mode !== 'bus') q.set('mode', st.mode);
  if (st.modes && st.modes !== 'brai') q.set('m', st.modes);      // domyślne warstwy (wszystkie) nie trafiają do linku
  return q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%2F/g, '/');   // czytelniej, a parser i tak to rozumie
}
// tekst po # -> stan (indeksy w bieżących danych; -1 / null gdy czegoś nie ma)
function decodeLink(hash) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, '')), out = { stop: -1, side: -1, route: -1, trip: -1, from: null, to: null };
  const v = (q.get('v') || '').split(',').map(Number);
  if (v.length === 4 && v.every(isFinite)) out.cam = { x: v[0], z: v[1], yaw: (v[2] + .5) * Math.PI / 2, half: clamp(v[3], 40, 7000) };
  if (q.has('s')) {
    const g = groupByName(q.get('s'));
    if (g) { out.stop = g.members[0]; const pl = q.get('side'); const m = pl && S.side ? g.members.find(m => S.side[m].plat === pl) : undefined; if (m !== undefined) { out.stop = m; out.side = m; } }
  }
  if (q.has('l')) out.route = D.routes.findIndex(r => r.n === q.get('l'));
  if (q.has('t')) { const ti = S.tripById.get(q.get('t')); out.trip = ti === undefined ? -1 : ti; }
  out.from = decodePlace(q.get('from')); out.to = decodePlace(q.get('to'));
  const hm = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m && +m[1] < 30 && +m[2] < 60 ? +m[1] * 3600 + +m[2] * 60 : null; };
  out.at = hm(q.get('at')); out.time = hm(q.get('time'));
  if (q.has('speed')) out.speed = +q.get('speed');
  if (/^([brai]{1,4}|-)$/.test(q.get('m') || '')) out.modes = q.get('m');
  if (['bus', 'rail', 'air', 'infra'].includes(q.get('mode'))) out.mode = q.get('mode');
  return out;
}

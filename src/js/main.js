/* ======================= START ======================= */
async function main() {
  if (!gl) throw new Error('Ta przeglądarka nie obsługuje WebGL 2.');
  setProgress(.1, 'Rozpakowywanie rozkładu…'); await tick();
  D = await loadData();
  setProgress(.3, 'Indeksowanie kursów…'); await tick();
  prepData(); buildStopGroups(); buildStopSides(); buildGeo(); raptorIndex();
  setProgress(.45, 'Układanie dróg…'); await tick();
  buildGrid();
  setProgress(.6, 'Stawianie budynków…'); await tick();
  const city = D.map ? null : buildCity();
  setProgress(.85, 'Przygotowanie grafiki…'); await tick();
  R.distTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, R.distTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, GN, GN, 0, gl.RED, gl.UNSIGNED_BYTE, gridDist);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  R.cubeBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, R.cubeBuf); gl.bufferData(gl.ARRAY_BUFFER, cubeGeo(), gl.STATIC_DRAW);
  R.prismBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, R.prismBuf); gl.bufferData(gl.ARRAY_BUFFER, prismGeo(), gl.STATIC_DRAW);
  if (D.map) buildWorld(); else staticBox = boxVAO(city.data, false);
  dynBox = boxVAO(dyn, true);
  setProgress(.92, 'Rysowanie podpisów…'); await buildAtlas();
  const E = 40000; groundV = vaoFrom(new Float32Array([-E, -E, E, -E, E, E, -E, -E, E, E, -E, E]), [[0, 2, 2, 0]]);
  if (!WORLD) { const rg = stripGeo(S.shapes.map((_, i) => i)); roadV = vaoFrom(rg, STRIP); roadCount = rg.length / 7; }

  // UI: linie, info
  renderLines();
  document.querySelectorAll('[data-lf]').forEach(b => b.onclick = () => { lineFilter = b.dataset.lf; store.set('lineFilter', lineFilter); renderLines(); });
  $('#lineGrid').addEventListener('click', e => { const c = e.target.closest('[data-r]'); if (!c) return; const ri = +c.dataset.r; select({ route: ri }); fitShapes([...S.routeShapes[ri]]); $('#linesOv').classList.remove('show'); });
  const f = D.feed;
  $('#about').innerHTML = `Źródło danych: <b>ZTM Rzeszów</b> — <a href="https://otwartedane.erzeszow.pl/dataset/rozklady-jazdy-gtfs">otwartedane.erzeszow.pl</a>, w opracowaniu <a href="https://kmrzeszow.live/otwartedane/">kmrzeszow.live</a> (wersja ${esc(f.version || '')}, ważna ${esc(f.start || '')}–${esc(f.end || '')}, opublikował ${esc(f.publisher || '')}${f.built ? ', zbudowano ' + esc(f.built) : ''}). Dane zostały przetworzone. Gmina Miasto Rzeszów nie ponosi odpowiedzialności za dostępność, poprawność, aktualność, kompletność i jakość przetworzonych danych.<br><br>${WORLD ? `Budynki, woda, teren, drogi i tory pochodzą z <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (ODbL). Wysokości budynków są z OSM, a gdy ich brak, szacowane z typu i powierzchni. Drzewa w lasach są rozmieszczane w granicach lasów z OSM, nie według rzeczywistych pozycji. ${WORLD.counts.buildings.toLocaleString('pl-PL')} budynków, ${WORLD.counts.trees.toLocaleString('pl-PL')} drzew.` : `Budynki i zieleń są <b>poglądowe</b> — generowane proceduralnie wzdłuż tras, nie odpowiadają rzeczywistej zabudowie. Trasy, przystanki i rozkład są prawdziwe. ${city.buildings.toLocaleString('pl-PL')} budynków, ${city.trees.toLocaleString('pl-PL')} drzew.`}`;
  $('#attr').textContent = (f.map_source ? 'Mapa i adresy © OpenStreetMap · ' : f.addr_source ? 'Adresy © OpenStreetMap · ' : '') + 'Dane: ZTM Rzeszów (przetworzone)' + (f.publisher ? ' · ' + f.publisher : '') + (f.built ? ' · ' + f.built : '') + (f.map_source ? '' : ' · zabudowa poglądowa') + ' · Pogoda: Open-Meteo.com';
  $('#about').insertAdjacentHTML('beforeend', '<br><br>Pogoda: <a href="https://open-meteo.com/">Open-Meteo.com</a> (CC BY 4.0), aktualna dla Rzeszowa, odświeżana co 15 minut.');
  syncOpts(); syncSpeedBtns(); autoLive(); setupA11y(); loadChanges(); startWeather();
  setProgress(1, 'Gotowe'); resize(); updateCamera();
  $('#loading').style.display = 'none';
  addEventListener('resize', () => { resize(); lastSheet = 0; });
  const initial = location.hash; linkLast = initial.slice(1);
  requestAnimationFrame(render);
  requestAnimationFrame(() => applyLink(initial));           // po pierwszej klatce: arkusze potrzebują stanu symulacji
}
// tryb offline i instalacja na ekranie telefonu; service worker działa tylko z http(s), nie z pliku
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker:', e.message)));
}
main().catch(err => { console.error(err); $('#err').textContent = 'Błąd: ' + err.message; });

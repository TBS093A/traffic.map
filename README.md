# Rzeszów w pikselach

Izometryczna mapa pixel-art komunikacji miejskiej w Rzeszowie (WebGL 2, bez zależności)
oraz pipeline, który cyklicznie pobiera aktualny rozkład GTFS i przebudowuje stronę.
Budynki, woda, teren, drogi i tory pochodzą z OpenStreetMap.

![Centrum Rzeszowa: prawdziwa zabudowa z OpenStreetMap, ulice i autobusy na trasach](docs/screenshots/centrum.png)

## Screeny
| | |
|---|---|
| ![Wisłok i dzielnice na wschód od centrum: osiedla, hale i zabudowa jednorodzinna](docs/screenshots/wislok.png) | ![Cały obszar sieci: Rzeszów z Wisłokiem, zalewem i okolicznymi lasami](docs/screenshots/miasto-dzien.png) |
| **Wisłok:** rzeka, osiedla i hale | **Całość:** miasto, zalew i lasy w okolicy |
| ![Centrum miasta nocą, z oświetlonymi oknami i autobusami na trasach](docs/screenshots/miasto-noc.png) | ![Podświetlona trasa linii 17 z dwoma autobusami w drodze](docs/screenshots/linia.png) |
| **Noc:** światła w oknach i autobusy według rozkładu | **Linia:** trasa i autobusy wybranej linii |
| ![Zbliżenie na zabudowę z tablicą odjazdów przystanku Rejtana / Krzyżanowskiego](docs/screenshots/przystanek.png) | ![Siatka numerów wszystkich linii ZTM](docs/screenshots/lista-linii.png) |
| **Przystanek:** tablica odjazdów | **Linie:** lista wszystkich linii ZTM |
| ![Planer z połączeniem z ul. Lwowskiej 60 na Krakowską 20](docs/screenshots/planer.png) | ![Wybrane połączenie narysowane na mapie, z rozpisanymi odcinkami](docs/screenshots/planer-trasa.png) |
| **Planer:** połączenia od adresu do adresu | **Trasa:** wybrany wariant na mapie |

<img src="docs/screenshots/mobile.png" alt="Widok mapy na telefonie" width="260">

**Telefon:** ten sam widok na wąskim ekranie.

Screeny pokazują rozkład i dane OSM z 7 listopada 2026.

## Pliki
| Plik | Co robi |
|---|---|
| `pipeline.py` | pobiera GTFS, sprawdza zmiany, buduje i podmienia `dist/index.html` |
| `run.sh` | wrapper dla crona (ustawia katalog roboczy i Pythona) |
| `pipeline.example.json` | przykładowa konfiguracja — skopiuj do `pipeline.json`, jeśli chcesz coś zmienić |
| `prep.py` | GTFS → kompaktowy `data.json` (rzutowanie, upraszczanie tras, wzorce kursów) |
| `osm.py` | warstwy OpenStreetMap → kompaktowa mapa (budynki, teren, woda, drogi, drzewa) |
| `build.py` | wkleja dane (gzip + base64) do szablonu strony |
| `index.src.html` | szablon strony: renderer, UI, logika rozkładu (z wbudowanym [earcut](https://github.com/mapbox/earcut), ISC) |
| `proxy.mjs` | proxy GTFS-Realtime → JSON i serwer strony (Node 18+, bez zależności) |
| `docs/screenshots/` | screeny używane w tym README |

Wymagania: Python 3.9+ (tylko biblioteka standardowa) i, do pozycji na żywo, Node 18+.

## Szybki start
```sh
cd traffic.map
python3 pipeline.py -v          # pierwszy build → dist/index.html
```
`dist/index.html` to samodzielny plik: można go otworzyć w przeglądarce albo wrzucić na hosting.

## Cron (Linux / macOS)
Pipeline sprawdza zmiany, więc może chodzić często. Gdy nic się nie zmieniło, serwer odpowiada
`304` i nic się nie przebudowuje. Paczka kmrzeszow.live obejmuje tylko kilka dni do przodu,
dlatego uruchamiaj go co najmniej raz dziennie. Rozsądnie jest co godzinę:

```sh
crontab -e
```
```
17 * * * * /ścieżka/do/traffic.map/run.sh >> /ścieżka/do/traffic.map/work/cron.log 2>&1
```
Na standardowe wyjście trafiają tylko ostrzeżenia i błędy. Pełny log jest w `work/pipeline.log`
(rotacja 3 × 1 MB).

macOS: jeśli projekt leży w Dokumentach, na Biurku albo w Pobranych, nadaj `/usr/sbin/cron`
„Pełny dostęp do dysku” (Ustawienia → Prywatność i ochrona). Inaczej cron nie zobaczy plików.

## Windows (Harmonogram zadań)
```bat
schtasks /Create /SC HOURLY /MO 1 /TN "RzeszowWPikselach" /TR "py C:\ścieżka\traffic.map\pipeline.py"
```

## Jak działa pipeline
1. **Blokada.** Jeśli poprzednie uruchomienie jeszcze trwa, nowe kończy się od razu.
2. **Pobranie.** Źródła są pobierane po kolei, z nagłówkami `If-None-Match` / `If-Modified-Since`.
   Zapasowe źródło jest odpytywane tylko wtedy, gdy główne zawiedzie albo jego rozkład nie obejmuje dziś.
3. **Weryfikacja paczki.** Sprawdzana jest integralność ZIP, obecność wymaganych plików GTFS
   i zakres dat.
4. **Wykrywanie zmian.** Build rusza tylko wtedy, gdy zmieniła się paczka, dane OSM albo kod
   (`index.src.html`, `prep.py`, `osm.py`, `build.py`). `--force` wymusza build.
5. **Build i walidacja.** Wynik musi mieć minimalną liczbę linii, kursów i przystanków
   oraz niepusty kalendarz.
6. **Atomowa podmiana.** `dist/index.html` jest podmieniany jednym `rename`, więc nigdy nie ma
   wersji w połowie zapisanej. Przy każdym błędzie zostaje poprzednia, działająca strona.
7. **Archiwum.** Użyte paczki trafiają do `work/archive/` (domyślnie 14 ostatnich).
   `dist/build-info.json` opisuje, z czego zbudowano stronę.
8. **post_build** (opcjonalnie). Komenda po udanym buildzie, np. wysyłka na serwer:
   ```json
   "post_build": "rsync -az dist/ user@serwer:/var/www/rzeszow/"
   ```
   Dostępne zmienne: `RWP_INDEX`, `RWP_OUT_DIR`, `RWP_SOURCE`, `RWP_FEED_VERSION`.

Kody wyjścia: `0` zbudowano albo bez zmian · `1` żadne źródło nie działa ·
`2` build nie przeszedł walidacji · `3` błąd `post_build`.

Jeśli żadna paczka nie obejmuje dzisiejszej daty, publikowana jest najlepsza dostępna,
a strona sama przełącza się na rozkład wzorcowy (sobota, niedziela albo dzień roboczy)
i pokazuje to przy zegarze.

## Pozycje na żywo
```sh
FEED_URL="<adres Vehicle Positions .pb z kmrzeszow.live/otwartedane>" node proxy.mjs
```
Otwórz http://localhost:8787/. Proxy serwuje `dist/index.html` i czyta go przy każdym żądaniu,
więc po przebudowie przez pipeline wystarczy odświeżyć stronę. W ⚙ Ustawienia wpisz
`http://localhost:8787/vehicles.json`.

## Silnik w skrócie
1. Scena renderowana do małej tekstury (rozmiar piksela 1–4) z wyjściami: kolor, normalne, głębia.
2. Post-processing: kontury z laplasjanu głębi i różnic normalnych, dithering Bayera 4×4,
   kwantyzacja do 32-kolorowej palety, skalowanie metodą najbliższego sąsiada.
3. Kamera ortograficzna (30°, obrót co 90°) przyciągana do siatki pikseli, więc obraz nie migocze.
4. Prostokątne budynki (ok. 80%), drzewa i autobusy to jeden instancjonowany prostopadłościan.
   Pozostałe budynki to bryły wyciągnięte z obrysu OSM (triangulacja dachów: earcut).
   Okna i nocne światła powstają w shaderze, wspólnym dla obu rodzajów budynków.
5. Teren i woda to płaskie wielokąty rysowane w kolejności klas (woda na wierzchu).
   Drogi, tory i cieki to pasy z szerokością zależną od klasy i zoomu.
6. Świat jest podzielony na kafle 1,5 km. Rysowane są tylko kafle w kadrze. W kaflu budynki są
   posortowane od największych, więc przy oddaleniu rysowany jest tylko początek listy.

## Mapa z OpenStreetMap
`pipeline.py` pobiera z Overpass API cztery warstwy dla obszaru sieci (`map` w konfiguracji) i trzyma je
w `work/cache/osm-*.json.gz`. Odświeża je co 14 dni, a każdą warstwę osobno. Gdy pobranie się nie uda, warstwa
zostaje w poprzedniej kopii, a brakująca jest pobierana przy następnym uruchomieniu. `osm.py` zamienia je na
kompaktowy format wklejany do strony (ok. 3,6 MB po kompresji, strona ma ok. 6 MB).

| Warstwa | Co z niej powstaje |
|---|---|
| budynki | ok. 167 tys. brył. Prostokątne zapisywane jako obrócony prostopadłościan, pozostałe z pełnym obrysem i dziedzińcami |
| teren | lasy, łąki, pola, ogródki, cmentarze, tereny przemysłowe, parkingi, boiska, woda (Wisłok, zalew, stawy) |
| drogi | od autostrad po drogi dojazdowe (te ostatnie tylko z bliska) oraz tory kolejowe |
| drzewa | pojedyncze drzewa (`natural=tree`) w dokładnych pozycjach |

Bez danych OSM (np. `"map": {"enabled": false}`) strona wraca do zabudowy poglądowej, generowanej wzdłuż tras.

## Podpisy i szukajka
- **Ulice:** nazwy pochodzą z kolumny `street_name` w `stops.txt`. Odcinek trasy między dwoma
  kolejnymi przystankami na tej samej ulicy dostaje jej nazwę (`streets` w `data.json`).
  Napis to płaski mesh 3D z glifów ułożonych wzdłuż ulicy, zawieszony 22 m nad nią.
  Proporcje liter są korygowane o skrót perspektywy, a napis zawsze czyta się z lewej do prawej.
  Za budynkiem napis się przyciemnia. Rozmieszczenie unika kolizji i jest przeliczane przy zmianie zoomu i obrocie.
- **Przystanki:** kropka na każdym słupku i jeden podpis na grupę słupków o tej samej nazwie.
  Tablica odjazdów łączy wszystkie słupki grupy.
- **Szukajka** (🔍 albo `/`): linie po numerze lub nazwie trasy, przystanki po nazwie,
  bez względu na polskie znaki.

## Lista przystanków i planer połączeń
- **🚏** to alfabetyczna lista przystanków z filtrem i liniami, które się na nich zatrzymują.
- **🧭** (albo klawisz `P`, albo „Stąd” / „Dotąd” na tablicy przystanku) wyznacza połączenie
  algorytmem RAPTOR (Round-based Public Transit Routing). Liczy najszybszy dojazd bezpośrednio,
  z 1, 2 i 3 przesiadkami. Pokazuje tylko warianty, w których dodatkowa przesiadka daje szybszy dojazd.
  Uwzględnia przejścia piesze do 400 m (1,2 m/s, współczynnik krętości 1,25),
  minimum 60 s na przesiadkę i okno 4 h od wybranej godziny. Jedno wyszukiwanie trwa kilka ms w przeglądarce.
- Wybrany wariant jest rysowany na mapie: przejazdy w kolorach linii, przejścia piesze przerywaną
  linią, przystanki wsiadania i wysiadania podświetlone. Autobusy z wariantu są wyróżnione.

## Wyszukiwanie od adresu, strony ruchu, lokalizacja
- **Start i cel** mogą być: adresem („Rejtana 16”, „al. Piłsudskiego 34”, „Tyczyn 7, Tyczyn”),
  całą ulicą („Sikorskiego”, czyli dowolne miejsce na niej), przystankiem, Twoją lokalizacją albo punktem wskazanym
  na mapie. Planer dolicza dojście pieszo do przystanków w promieniu 1 km i pokazuje wariant pieszy
  do 2,5 km. Kolejne przejścia piesze są łączone w jedno.
- **Adresy z numerami** pochodzą z OpenStreetMap (ODbL). `pipeline.py` pobiera je z Overpass API
  (`addresses` w konfiguracji), trzyma kopię w `work/cache/addresses.json` i odświeża co 14 dni.
  Gdy pobranie się nie uda, używa poprzedniej kopii. Do strony trafiają adresy w promieniu 1,5 km
  od przystanków. Bez bazy adresów wyszukiwanie działa po nazwach ulic z danych przystanków.
- **Strony ruchu:** każdy słupek ma opis kierunku. Pokazywane są tylko kierunki odróżniające go od
  słupka po drugiej stronie, a gdy ich brak, następny przystanek. Tablica ma przełącznik stron, listy
  pokazują słupki pod nazwą przystanku, a z bliska mapa podpisuje każdy słupek osobno.
- **Moja lokalizacja** wymaga strony otwartej z `localhost` albo przez https. W podglądzie w Claude
  przeglądarka ją blokuje, wtedy działa „Wskaż na mapie”.

## Ograniczenia
- **Teren jest płaski.** Nie ma modelu wysokości, więc doliny i wzniesienia nie są widoczne.
- **Wysokości budynków** pochodzą z OSM tylko dla ok. 21% budynków (`height`, `building:levels`).
  Pozostałe są szacowane z typu i powierzchni. Wszystkie dachy są płaskie, kolor dachu zależy od typu budynku.
- **Drzewa w lasach** są rozmieszczane w granicach lasów z OSM, nie według rzeczywistych pozycji.
  Rzeczywiste pozycje mają tylko drzewa oznaczone w OSM pojedynczo.
- Mapa obejmuje prostokąt sieci ZTM (`bbox`). Poza nim jest tylko trawa.
- Paczka mkuran.pl (zapas) nie ma brygad, pełnych nazw linii ani nazw ulic (będą tylko podpisy przystanków).
- Podpisujemy tylko ulice, którymi jeżdżą autobusy i na których są co najmniej dwa kolejne przystanki.

## Dane
Mapa i adresy: © współtwórcy OpenStreetMap, licencja ODbL — https://www.openstreetmap.org/copyright.

Rozkład: ZTM Rzeszów — https://otwartedane.erzeszow.pl/dataset/rozklady-jazdy-gtfs,
w opracowaniu kmrzeszow.live (zapasowo: mkuran.pl). Dane zostały przetworzone.
Gmina Miasto Rzeszów nie ponosi odpowiedzialności za dostępność, poprawność, aktualność,
kompletność i jakość przetworzonych danych. Przed publicznym udostępnieniem sprawdź warunki
serwisu kmrzeszow.live (hello@kmrzeszow.live).

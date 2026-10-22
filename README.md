# Madeira Autocarros

Offline-first PWA with bus timetables for Madeira. Data comes from <https://siga.madeira.gov.pt/horarios>.

## Data pipeline

```
npm run scrape       # index + line pages + PDFs + shapedata -> data/raw (idempotent, 1 request/s)
npm run parse        # PDFs -> data/schedules.json, data/parse-report.json, data/shapes/
npm run build:data   # -> public/data (schedules, route geometry) and small original PDFs in public/pdf
npm run dev | build | preview | test
```

The site has no timetable API. Times exist only inside per-line PDFs, and only for terminals; stop lists and
route geometry come from `/horarios/shapedata/{id}`. PDF layouts differ, so there is one parser per family
(`scripts/parse-*.mjs`). A line is accepted only when the structure and the time counts check out
(`hasParsedSchedule`); everything else is listed with a reason in `data/parse-report.json` and the app offers the
original PDF instead.

`src/lib/holidays.ts` decides which timetable applies on a given day (weekday / Saturday / Sunday & holidays,
Madeira holidays, 25 Dec no service, Saturday timetable on 24/31 Dec, Carnival Tuesday and Holy Thursday).
Only the Funchal municipal holiday (21 Aug) is included.

## Estimates and journey planner

`npm run build:data` adds estimated passing times for intermediate stops (`scripts/lib-estimate.mjs`): distance along the
`shapedata` polyline / average speed (Funchal urban 16 km/h, other urban 20, interurban 25). Directions carry
`isEstimated: true` and `stopOffsets`; lines with printed per-stop times ("Locais Passagem") carry `trips` and
`isEstimated: false`. The UI marks estimates with `~`.

`src/lib/network.ts` + `src/lib/router.ts` implement the planner (direct trips and one transfer, minimum 5 minutes plus
walking time between stops within 200 m). `node scripts/e2e.mjs` drives the running dev server in headless Chrome
(needs `npm run dev` and Chrome).

## SAM sheets (east of the island)

`scripts/parse-sam.mjs` reads the Excel-export PDFs of operator SAM: rows are trips, columns are stops with printed times.
The PDFs paint several tables over each other and hide the rest with per-cell clipping, so `visibleItems()` in
`scripts/lib-pdf.mjs` walks the page operators and keeps only text that is really visible (and decodes the fonts whose
glyph codes are ASCII - 29). `node scripts/_shot.mjs <pdf> out.png` renders a PDF in Chrome for eyeballing a table.

The planner treats line type as a filter: intercity (default), urban or all; "prefer" also shows other types after the
preferred ones, "only" is strict. A transfer needs 12 minutes when either bus has estimated times, otherwise 5.

## Manual transcriptions (`data/manual/`)

A few PDFs cannot be parsed reliably: scans without a text layer (lines 56/103/138 "Rede Santana", 555, 725) and irregular
tables (lines 3, 4, 27, 109A, 127, 154, 163 and the Aerobus 500). They were read from the rendered pages
(`node scripts/_shot.mjs <pdf> out.png`) and written down by the generators in `scripts/manual/*.mjs`, which write
`data/manual/<lineId>.json`. `scripts/parse.mjs` merges them into the schedule (`family: "manual"`, with `manualSource`).
Re-run the generator after correcting a transcription, then `npm run parse && npm run build:data`.

Lines with printed per-trip destinations (96, 137) have their own parser (`scripts/parse-rowtables.mjs`).
Not parsed: the Funchal urban lines 032, 060-062, 090, 094 and 105 (several destination variants per table or
arrival/departure rows distinguished only by shading); the app offers their PDF.

## Audit (`npm run audit`)
`scripts/audit-schedules.mjs` checks `data/schedules.json` and writes `data/audit-report.json`:
time format and ascending order (00:00-02:59 counts as the end of the service day), empty day lists, the structure the app
expects (names, stops, trip length = stop count, note keys, `manualSource`), and a cross-check of the number of times
stored against the number of time patterns in the PDF text layer (>10 % difference = suspicious). Known, understood
differences: 181 (page 2 is a transfer shuttle table that is not modelled), 96 (intermediate "Corticeiras"/"J. Serra" passage
columns are not stored), 20/526/785/528 (SAM sub-tables, school variants), 127 (times in legend notes).

## Deployment (Cloudflare Pages)
The app is a static site; `npm run build` regenerates the data (`build:data`, from the committed `data/schedules.json`,
`data/shapes` and `data/pdf-fallback`) and then type-checks and builds into `dist/`. No scrape cache is needed on CI.
1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick `JanTrejtnar/madeira-timetables`, branch `main`.
2. Build command `npm run build`, build output directory `dist`, environment variable `NODE_VERSION=22` (also pinned in `.node-version`).
3. Save and deploy; every push to `main` redeploys. `public/_headers` keeps `sw.js`/`index.html`/`schedules.json` revalidating so the PWA picks up new data.
Direct deploy from a terminal: `npx wrangler login`, then `npm run deploy:cf`.

## Lines outside SIGA

`data/external/<id>.json` holds lines of other operators in the app's own format; `build:data` appends them to the dataset.
Currently: **9001 Pico do Areeiro** (Horários do Funchal, transcribed from
https://www.horariosdofunchal.pt/index.php/viajar/pico-do-areeiro by `scripts/make-external-pico.mjs`; road geometry from OSRM/OpenStreetMap
via `scripts/fetch-pico-route.mjs`, committed as `data/shapes/9001.json` / `9002.json`). Stops between two stops with known coordinates
get positions interpolated along the route (`scripts/lib-interpolate.mjs`, flag `isEstimatedLocation`).

PWA icons are rendered from `public/icon.svg` by `node scripts/make-icons.mjs`. `node scripts/e2e-pwa.mjs` checks manifest, service-worker
cache, offline reload and "stops near me" against `npx vite preview --port 4173`.

## Official stop positions (GTFS) and "all stops of a town"

- `npm run fetch:gtfs` downloads https://www.horariosdofunchal.pt/googletransit.zip and keeps the stops in `data/gtfs/stops.json` (committed, so `build:data` works offline).
- `build:data` matches SIGA stops to feed stops by stop code and takes the official position (fills missing ones, replaces SIGA's when within 150 m or when ours was only approximate); feed stop names also feed the name matching for text-only lines.
- Every stop gets a municipality (`muni`): nearest reference point (feed stops labelled by the operator + parish seats), else a locality/town named in the stop name, else the neighbouring stops of the direction. Only an approximation by position – borders are not exact.
- The planner suggests "<parish> (all stops)" first; the search then runs from/to every stop of that parish (freguesia). Municipalities are not groups: Santana spans Faial, São Jorge or Arco de São Jorge, valleys apart. The one exception is Funchal: "Funchal (all stops)" covers every stop of the municipality (Sé, São Martinho, Santa Luzia ...), because people look for the town, not for its parishes.

## "Via X" notes

- `npm run audit:via` lists every "Via ..." note of every timetable and why it is (not) a stop of the trips: `resolved` (position known, inserted into the trips carrying the note), `corridor` (Via Rápida / Expresso: label only), `no-stop-list` (the line has no parsed stop list), `already-a-stop`, `off-route`, `no-position`, `not-a-place` (several places or a street list).
- A note may name several places ("Via Ilha e St. António", "Via Cº Chão, Silveira, A. Marques e Ilha"): the text after "Via" is split at commas and "e", each place is resolved on its own and inserted in the printed order. Hand-made transcriptions (`data/manual/`) keep such notes as free text on the trip, so the text itself is the key (`line.via[text]`). Abbreviations (St. = Santo, Lº = Lombo do, Cº = Caminho, Ach. = Achada) are keys of `data/via-places.json`. With a route polyline the place goes to the stretch of road nearest to it; a place inserted this way also carries its parish, so "Ilha (all stops)" contains it.
- Positions: OSM names, else `data/via-places.json` (hand-placed; a key may list namesakes, the one on the route is used).

## OpenStreetMap stops, parishes, map picking

- `npm run fetch:osm` downloads bus stops (`highway=bus_stop`, `public_transport=platform`), village/town nodes and the
  concelho/freguesia boundaries of Madeira from the Overpass API into `data/osm/` (committed, so `build:data` needs no
  network; © OpenStreetMap contributors, ODbL).
- `build:data` uses it after the GTFS feed and the name index of the other routes, only for stops that still have no
  position: normalised name (abbreviations like "Estreito C.Lobos" resolved), disambiguated by the route polyline, the
  neighbouring stops or the municipality of the line; a stop named after its village falls back to the village node.
  Such stops are `approx: true, source: 'osm'` (matched by name) and listed as approximate in the app.
- Every stop gets `muni` and `par` (parish) from the boundary polygons; every parish with a stop is offered as "(all stops)" (a stop with the same name as its group is not listed twice).
  Stops without a position are placed by the parish named in the stop name, also abbreviated ("Fajã Ovelha", "S. Roque do Faial").
- The drawn route is joined to the first/last stop (`lib-shape-ends.mjs`, gaps up to 120 m); `node scripts/check-shape-ends.mjs`
  lists the rest. The Pico do Areeiro route (`npm run` → `node scripts/fetch-pico-route.mjs`) starts exactly on the GTFS stop 4A.
- Planner: "pick on map" next to From/To (nearest stop within 1 km), any date (`<input type=date>`, holidays via `holidays.ts`),
  arrow keys + Enter + Escape in the suggestions. The form is kept in App state and mirrored into the URL
  (`?from=…&fk=…&to=…&tk=…&date=…&time=…`), so Back from a line detail (or a reload) restores the search.
- `node scripts/e2e-planner.mjs <dev server url>` checks all of this in headless Chrome (phone and desktop).

## Places, walking routes, network map, catalogue and saved trips

Ideas taken from the open-source [madeirabus](https://github.com/nexgen-fullstack/madeirabus) (there: a nightly pipeline that builds a compact network bundle, a RAPTOR planner in a Web Worker, an own OSM street graph `walk.bin` for walking, OpenFreeMap vector tiles and a `pois.json` of ~6 400 OSM places); here done with what an offline PWA of static timetables needs:

- **Places of interest** (`npm run fetch:pois` -> `data/osm/pois.json`, committed): beaches, peaks, viewpoints, harbours, malls, museums, parks, levadas, hotels, notable churches ... from Overpass, plus `data/pois-curated.json` (famous destinations with hand-checked positions and English / Czech names) and the towns of `data/osm/places.json`. `build:data` merges them into `public/data/pois.json` (rows `[name, kind, lat, lon, alt?]`, precached). The autocomplete (`src/lib/places.ts`, `PlannerTab.tsx`) shows stops, "all stops of" areas and places in one list, each with an icon and its category on the right (Zastávka, Pláž, Vyhlídka, Vrchol, Přístav, Obchodní centrum, Město ...).
- **A place as start or destination** stands for the stops within 900 m (else the nearest few within 2.2 km, with a note): `nodesNearPoint` in `src/lib/network.ts`. The place is kept in the URL (`fk/tk=@poi:<name>` + `fp/tp`) and shares the walking logic of the "pick on map" pin.
- **Walking along real streets** (`src/lib/foot.ts`): the public OpenStreetMap OSRM `routed-foot` service gives the street geometry between a pin and its stop, and between the platforms of a transfer; results are cached (memory + localStorage), the real distance replaces the straight-line estimate in the card, and offline or on a timeout the straight dashed line stays (`e2e-showcase.mjs` checks both).
- **Network map** (`Mapa` tab; `NetworkMap.tsx`): `public/data/overview.json` (`scripts/lib-overview.mjs`: one Douglas-Peucker-simplified, delta-encoded polyline per line, ~180 KB) drawn on one Leaflet canvas in the colour of the operator, stops as tappable points (hubs first, all stops from zoom 14; the nodes come from the planner network, so both sides of a road are one point). A tap opens a panel with the lines, the next departures and "Odkud / Kam" buttons; operators can be switched off in the legend.
- **Linky** tab: the catalogue by operator (`src/lib/operators.ts`: Horários do Funchal, Rodoeste, SAM, CAM / EACL, derived from the number ranges and the timetable family), each with its accent colour, label, line count and the termini of every line; the search field stays above it.
- **Desktop layout** (`App.tsx`, `splitView`): the start page (form, favourites, recent trips) is one centred column without a map; the map beside the panel appears with the search results, an opened line, or the `Mapa` tab.
- **Earlier / later connections** (`PlannerTab.tsx`): the buttons above and below the results move the search time to just before the first / after the last connection shown (probing with `run(at)`, widening the look-back until something turns up) and write it to the URL (`time`, `date` past midnight).
- **Sharing a connection** (`Connection.tsx`, `connectionLink` in `plannerForm.ts`): the share icon of the detail uses `navigator.share`, else copies the link and shows a toast. The link carries start, destination, day, the time the bus leaves and `c=<lineId>.<HH:MM>`, which opens the detail once the results are in.
- **Recent and favourite trips** (`src/lib/trips-store.ts`, `TripShortcuts.tsx`): the last five searches and the starred connections under the form, in `localStorage` (`recentTrips.v1`, `favoriteTrips.v1`).

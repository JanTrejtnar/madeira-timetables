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

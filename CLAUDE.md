# Madeira timetables – notes for developers and assistants

## Stops without coordinates

`npm run build:data` writes `data/missing-stops.json` (script `scripts/audit-stops.mjs`, also `npm run audit:stops`):
stops without any coordinates (`missing`) and stops whose position is only an estimate (`estimated`), with the lines that serve them.

**Whenever a developer or an assistant adds coordinates for a previously unknown stop (e.g. in `data/stop-overrides.json`), the stop must leave the `missing` list of `data/missing-stops.json`, and `npm run build:data` must be run.** The list is regenerated from the built data, so after the build the stop must no longer be in it; check that, and commit the updated `data/missing-stops.json` together with the override.
Hand-entered or estimated positions are labelled as such (`locationPrecision`), never presented as official.

Override options in `data/stop-overrides.json`: `lines` limits an override to some lines, `adjacent` (names of neighbouring stops) to the directions where the stop stands next to one of them – for a name that is two different places on one line (e.g. `Rib. Machico` on line 20). The corridor matcher takes `--line N` and `--adjacent "Name"` for the same purpose.
Precisions of overrides: `name_match` (position of an official SIGA planner stop of the same name, `data/sources/siga/siga-otp-dump.json`), `manual_osm_match`, `corridor_osm_match`, `interpolated_road_point`, `place_centroid` (centre of an OSM place; the platform is not known), `interpolated` (straight-line midpoint). All except `exact` show the warning in the UI.

Stop names: the printed abbreviations of the operators (`P.Cruz`, `S.Serra`, `S.Cruz` …, `scripts/lib-abbrev.mjs`) are resolved in `keyOf` (so an override, OSM, the SIGA dump and `inheritSameSpot` see "Porto da Cruz") and a stop whose whole name is such an abbreviation is shown under the full name. Add a new abbreviation there, not as a second override. `npm run build:data` also prints `scripts/audit-split-stops.mjs` (one place printed differently, a position known on one side only) – review that list after a data change. A settlement-centre / interpolated estimate with a single official stop of a differently printed name within 150 m (words a subset, official stops within 50 m of each other) takes its position as `inherited_split_stop` (`inheritSplitStops` in `lib-coords.mjs`; hand-placed overrides are never moved).

## Sdílené pomocné funkce

`shared/geo.mjs` je jediný zdroj pravdy pro vzdálenosti (`haversineKm`/`haversineM`, `metres` = rychlá plochá aproximace, `metresToSegment`, `localSq`) a normalizaci textu (`norm`); používá ho `src/` i `scripts/`. Nový výpočet vzdálenosti nebo normalizace patří tam, ne jako další lokální kopie (konstanty `111320`, `110540`, `6371`, `0.84` mimo tento soubor jsou chyba). Změna tohoto modulu mění build dat: porovnej kontrolní součty `public/data/*.json` před a po.

Mapy (Leaflet) se načítají líně: komponenty `RouteMap`, `NetworkMap` a `MapPicker` se importují jen přes `src/components/LazyMaps.tsx`, nikdy přímo, jinak se Leaflet vrátí do hlavního chunku.

## Povinný verifikační proces před každým commitem/pushem

Vývojář/asistent MUSÍ před každým commitem automaticky a bez vyzvání spustit a ověřit tuto kompletní pipeline (E2E sady potřebují běžící dev server `npx vite --port 5173`):

1. `npm run build:data` (přegenerování dat, kontrola chybějících zastávek a poznámek)
   - po každé změně poloh zastávek (override, `inheritSameSpot`, nové souřadnice) jsou uložené trasy zastaralé: spusť `npm run fetch:routes` (překreslí jen změněné směry) a pak znovu `npm run build:data`, jinak `shape-ends.test.ts` selže na odchylce konců tras (druhá, nahodilá příčina – timeout pod zátěží – je ošetřena v samotném testu)
2. `npx tsc -b` (striktní typová kontrola bez chyb)
3. `npm test` (vitest unit testy)
4. E2E kontrolní sady: `node scripts/e2e-line96.mjs`, `node scripts/e2e-line208.mjs`, `node scripts/e2e-trim-notes.mjs`, `node scripts/e2e-ux.mjs`, `node scripts/e2e-planner.mjs`, `node scripts/e2e-map.mjs`, `node scripts/e2e-mobile.mjs`
5. `npm run build` (produkční vite build)

Celý postup (včetně fetch:routes a časových limitů pro každý krok, `e2e-ux` trvá ~150 s, limit 240 s) spustí `npm run verify` (`-- --skip-e2e` vynechá E2E). Dev server si `verify` obstará sám: použije `E2E_PORT`/`PORT` (výchozí 5173), pokud tam běží tato aplikace; jinak (port volný nebo obsazený cizím serverem) na dobu běhu spustí vlastní Vite na volném portu. E2E skripty používají stejné proměnné, takže jde i `E2E_PORT=5174 node scripts/e2e-ux.mjs`.

**Pokud jakýkoliv krok selže, kód se nesmí pushnout na main, dokud není chyba opravena.**

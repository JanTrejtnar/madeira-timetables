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

## Data a chybové stavy

`src/lib/validate.ts` (`datasetProblem`/`isDataset`) je ruční kontrola tvaru `schedules.json` (žádná knihovna typu zod). `loadDataset` v `src/data.ts` použije platná čerstvá data a uloží je do Cache Storage (`dataset-last-good`); když stažení selže nebo data neprojdou kontrolou, tiše se použije poslední dobrá kopie, a teprve bez ní se zobrazí stránka „Data jízdních řádů jsou dočasně nedostupná“ (`ErrorBoundary.tsx`; ta zachytí i pád vykreslování). Přidáš-li do dat pole, které aplikace povinně čte, doplň ho do `datasetProblem`.

Planner: stav a výsledky v `src/components/planner/usePlanner.ts`, samotné hledání je čistá funkce `runSearch` v `src/lib/plannerSearch.ts`, `PlannerTab.tsx` jen skládá díly.

RAPTOR (`runSearch` volá `planRaptor`; starý `plan()` v `router.ts` zůstává jako referenční implementace pro paritní testy, UI ho nepoužívá; detail spojení ukazuje pěší krok před každým autobusem z `Leg.walkBefore` a `chůze celkem`, E2E `scripts/e2e-transfers.mjs`): `src/lib/raptor.ts` je čisté jádro nad ploškými typed arrays (žádné `Line`/`Trip`/React; rRAPTOR = běh na každý odjezd od nejpozdějšího, štítky se sdílejí mezi běhy; dvě třídy štítků kvůli bufferu 5/12 min podle dvojice spojů; u každé třídy dva štítky (nejlepší a nejlepší od jiné linky, aby shoda příjezdů dvou linek nezablokovala přestup zákazem návratu na tutéž linku); zpětné BFS od cíle ořezává štítky, ze kterých se cíl nestihne; max. 2 přestupy). `src/lib/raptorAdapter.ts` převádí `Network`/`Trip[]` na index (`prepare`, cache podle pole `trips`), přenáší pravidla routeru jako hooky (`board`: zákaz návratu do výchozí oblasti a U-turnu na stejnou linku, `leg`: `shortHop`/`lastHop`/`closer`) a vrací `Itinerary` s novým `Leg.walkBefore`. Testy: `src/lib/raptor.test.ts` (syntetická data), `src/lib/raptorAdapter.test.ts`, `tests/raptor-parity.test.ts` (reálná data: každý itinerář `plan()` musí být dorovnán nebo překonán; sdílené štítky = běhy od nuly bez limitu čekání). Limit čekání na přestupu (`maxWait`) dělá štítky nemonotónní (dřívější příjezd = delší čekání), proto se při něm sdílený běh může na okraji okna lišit od běhů od nuly; měřítkem zůstává parita s `plan()`. `planRaptor` hledá okno 3 h, pak 24 h (nejvýš 100 běhů) dokud není 8 přímých spojení, a když není nic, najde jedním během „nejdřívější příjezd“ první spojení. Rychlost: `npm run bench:raptor` (potřebuje dev server tohoto projektu, `E2E_PORT`; CPU throttling přes CDP). Změníš-li pravidla v `router.ts`, uprav i hooky v adaptéru.

## Offline mapy

Nastavení → Offline mapy stáhne jeden PMTiles archiv (`ARCHIVE_URL` = `maps/madeira.pmtiles`, vektorové dlaždice Madeira + Porto Santo) po kusech 2 MB do Cache Storage (`offline-maps-v1`, `src/lib/offlineMaps.ts`; instalace je atomická – záznam `meta` se zapíše jako poslední, přerušené stažení pokračuje). Mapy (`src/lib/basemap.ts`) pak kreslí `protomaps-leaflet` z uloženého balíčku (`vectorBasemap.ts`, načítá se líně jen s balíčkem; světlý/tmavý motiv podle tématu aplikace); bez balíčku zůstávají online dlaždice OSM. Součástí balíčku jsou i geometrie všech tras: `build:data` je sloučí do `public/data/shapes-all.json` (`scripts/lib-shapes-pack.mjs`, + `shapes-all.meta.json` s `rev`/`bytes`/`raw`), stahování je rozbalí do cache `shapes` pod stejnými klíči `data/shapes/<id>.json?v=<shapeRev>`, jaké používá běžný `loadShape` (`shapeFileUrl` v `src/data.ts`), a smazání balíčku je zase odstraní (jen ty, které balíček zapsal; seznam je v záznamu `meta`). Mění-li se klíč trasy v `loadShape`, mění se jen `shapeFileUrl`. Sekce v Nastavení se nezobrazí, dokud server archiv nemá.

**Dlaždice z `tile.openstreetmap.org` se nikdy nepředstahují** (pravidla OSMF). Skutečný archiv je `public/maps/madeira.pmtiles` (sledovaný gitem, ~12 MB; jméno i cesta jsou napevno v `ARCHIVE_URL`, `src/lib/offlineMaps.ts`; sekce v Nastavení se objeví sama, jakmile tam server soubor má). Je to PMTiles v3 s vektorovými dlaždicemi ve schématu Protomaps basemap (`protomaps-leaflet` 5.x). Vytvoří / obnoví ho `node scripts/download-madeira-pmtiles.mjs` (Range požadavky na nejnovější denní build `build.protomaps.com`, bbox `-17.30,32.60,-16.25,33.15`, zoom 0–15; volby `--bbox --maxzoom --date --source --out`); po obnovení zkontroluj velikost (Cloudflare Pages: max 25 MiB na soubor; větší patří jinam a pak se musí změnit `ARCHIVE_URL` a nastavit CORS pro Range a ETag) a atribuci © OpenStreetMap contributors, Protomaps. Testy a e2e používají commitnutou fixture `tests/fixtures/madeira-test.pmtiles` (generuje ji `scripts/make-test-pmtiles.mjs` z tras projektu, není to mapa); e2e ji zkopíruje na `public/maps/` jen tehdy, když tam archiv chybí.

## Povinný verifikační proces před každým commitem/pushem

Vývojář/asistent MUSÍ před každým commitem automaticky a bez vyzvání spustit a ověřit tuto kompletní pipeline (E2E sady potřebují běžící dev server `npx vite --port 5173`):

1. `npm run build:data` (přegenerování dat, kontrola chybějících zastávek a poznámek)
   - po každé změně poloh zastávek (override, `inheritSameSpot`, nové souřadnice) jsou uložené trasy zastaralé: spusť `npm run fetch:routes` (překreslí jen změněné směry) a pak znovu `npm run build:data`, jinak `shape-ends.test.ts` selže na odchylce konců tras (druhá, nahodilá příčina – timeout pod zátěží – je ošetřena v samotném testu)
2. `npx tsc -b` (striktní typová kontrola bez chyb)
3. `npm test` (vitest unit testy)
4. E2E kontrolní sady: `node scripts/e2e-line96.mjs`, `node scripts/e2e-line208.mjs`, `node scripts/e2e-trim-notes.mjs`, `node scripts/e2e-ux.mjs`, `node scripts/e2e-planner.mjs`, `node scripts/e2e-transfers.mjs`, `node scripts/e2e-map.mjs`, `node scripts/e2e-mobile.mjs`, `node scripts/e2e-robust.mjs`, `node scripts/e2e-offline-map.mjs`
5. `npm run build` (produkční vite build)

Celý postup (včetně fetch:routes a časových limitů pro každý krok, `e2e-ux` trvá ~150 s, limit 240 s) spustí `npm run verify` (`-- --skip-e2e` vynechá E2E). Dev server si `verify` obstará sám: použije `E2E_PORT`/`PORT` (výchozí 5173), pokud tam běží tato aplikace; jinak (port volný nebo obsazený cizím serverem) na dobu běhu spustí vlastní Vite na volném portu. E2E skripty používají stejné proměnné, takže jde i `E2E_PORT=5174 node scripts/e2e-ux.mjs`.

**Pokud jakýkoliv krok selže, kód se nesmí pushnout na main, dokud není chyba opravena.**

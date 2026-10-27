# Madeira timetables – notes for developers and assistants

## Stops without coordinates

`npm run build:data` writes `data/missing-stops.json` (script `scripts/audit-stops.mjs`, also `npm run audit:stops`):
stops without any coordinates (`missing`) and stops whose position is only an estimate (`estimated`), with the lines that serve them.

**Whenever a developer or an assistant adds coordinates for a previously unknown stop (e.g. in `data/stop-overrides.json`), the stop must leave the `missing` list of `data/missing-stops.json`, and `npm run build:data` must be run.** The list is regenerated from the built data, so after the build the stop must no longer be in it; check that, and commit the updated `data/missing-stops.json` together with the override.
Hand-entered or estimated positions are labelled as such (`locationPrecision`), never presented as official.

## Povinný verifikační proces před každým commitem/pushem

Vývojář/asistent MUSÍ před každým commitem automaticky a bez vyzvání spustit a ověřit tuto kompletní pipeline (E2E sady potřebují běžící dev server `npx vite --port 5173`):

1. `npm run build:data` (přegenerování dat, kontrola chybějících zastávek a poznámek)
   - po každé změně poloh zastávek (override, `inheritSameSpot`, nové souřadnice) jsou uložené trasy zastaralé: spusť `npm run fetch:routes` (překreslí jen změněné směry) a pak znovu `npm run build:data`, jinak `shape-ends.test.ts` selže na odchylce konců tras (druhá, nahodilá příčina – timeout pod zátěží – je ošetřena v samotném testu)
2. `npx tsc -b` (striktní typová kontrola bez chyb)
3. `npm test` (vitest unit testy)
4. E2E kontrolní sady: `node scripts/e2e-line96.mjs`, `node scripts/e2e-line208.mjs`, `node scripts/e2e-trim-notes.mjs`, `node scripts/e2e-ux.mjs`, `node scripts/e2e-planner.mjs`, `node scripts/e2e-map.mjs`, `node scripts/e2e-mobile.mjs`
5. `npm run build` (produkční vite build)

Celý postup (včetně fetch:routes a časových limitů pro každý krok, `e2e-ux` trvá ~150 s, limit 240 s) spustí `npm run verify` (dev server musí běžet; `-- --skip-e2e` vynechá E2E).

**Pokud jakýkoliv krok selže, kód se nesmí pushnout na main, dokud není chyba opravena.**

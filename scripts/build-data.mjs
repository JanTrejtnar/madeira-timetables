// Copies parsed data into public/ for the app: schedules.json, route geometries and (small) original PDFs
// of lines whose schedule could not be parsed. Everything else links to the original siga.madeira.gov.pt PDF.
import { cp, mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addEstimates } from './lib-estimate.mjs';
import { classifyLine } from './lib-classify.mjs';
import { buildStopIndex, fillCoords } from './lib-coords.mjs';
import { interpolateStops } from './lib-interpolate.mjs';
import { snapShapeEnds } from './lib-shape-ends.mjs';
import { applyOsm } from './lib-osm.mjs';
import { prepareAreas } from './lib-areas.mjs';
import { cleanTexts } from './lib-text.mjs';
import { addViaPlaces, attachViaRoutes } from './lib-via.mjs';
import { attachRoutes } from './lib-routes.mjs';
import { addTerminalStops, estimateTerminals } from './lib-terminals.mjs';
import { enrichStops, enrichedKm, addPlannerDepartures } from './lib-enrich.mjs';
import { applyOverrides, applyFunchalTerminals, terminalWalks } from './lib-overrides.mjs';
import { applyGtfs, assignMunicipalities, gtfsAsLine } from './lib-gtfs.mjs';
import { buildPois } from './lib-pois.mjs';
import { buildOverview } from './lib-overview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public');
const MAX_LOCAL_PDF = 1_000_000;
const data = JSON.parse(await readFile(path.join(ROOT, 'data', 'schedules.json'), 'utf8'));

await rm(path.join(OUT, 'data'), { recursive: true, force: true });
await rm(path.join(OUT, 'pdf'), { recursive: true, force: true });
await mkdir(path.join(OUT, 'data'), { recursive: true });
await mkdir(path.join(OUT, 'pdf'), { recursive: true });

const reclassified = [];
let local = 0;
// legend texts the parser cut off (data/note-fixes.json)
const noteFixes = JSON.parse(await readFile(path.join(ROOT, 'data', 'note-fixes.json'), 'utf8')).fixes ?? {};
let estimated = 0;
const rejected = [];
for (const l of data.lines) {
  Object.assign((l.notes ??= {}), noteFixes[l.number] ?? {});
  delete l.warnings; // parser diagnostics are not needed in the app
  const why = classifyLine(l, path.join(ROOT, 'data', 'shapes'));
  if (why) reclassified.push(`${l.number}: ${why}`);
  estimated += addEstimates(l, path.join(ROOT, 'data', 'shapes'));
  // keep only the legend entries that some departure refers to (SAM sheets carry a 30-line legend)
  const used = new Set();
  for (const d of l.directions) {
    for (const list of Object.values(d.departures)) for (const x of list) (x.notes ?? []).forEach((n) => used.add(n));
    for (const tr of d.trips ?? []) (tr.notes ?? []).forEach((n) => used.add(n));
  }
  l.notes = Object.fromEntries(Object.entries(l.notes ?? {}).filter(([k]) => used.has(k)));
  for (const d of l.directions) if (d.estimateRejected) rejected.push(`${l.number}: ${d.estimateRejected}`);
  // data/raw is not in git (CI has no scrape cache): PDFs of unparsed lines are kept in data/pdf-fallback (committed copy)
  const name = path.basename(l.pdfFile);
  const rawSrc = path.join(ROOT, 'data', 'raw', l.pdfFile);
  const fallbackSrc = path.join(ROOT, 'data', 'pdf-fallback', name);
  const src = (await stat(rawSrc).then(() => true, () => false)) ? rawSrc : fallbackSrc;
  if (!l.hasParsedSchedule && (await stat(src).then((x) => x.size <= MAX_LOCAL_PDF, () => false))) {
    if (src === rawSrc) { await mkdir(path.dirname(fallbackSrc), { recursive: true }); await cp(rawSrc, fallbackSrc); }
    await cp(src, path.join(OUT, 'pdf', name));
    l.pdfLocal = `pdf/${name}`;
    local++;
  }
  delete l.pdfFile;
}
// lines from other operators (data/external/<id>.json, not in SIGA), already in the app's format
for (const f of (await readdir(path.join(ROOT, 'data', 'external'))).filter((x) => x.endsWith('.json')).sort()) {
  const ext = JSON.parse(await readFile(path.join(ROOT, 'data', 'external', f), 'utf8'));
  ext.isInterurbano = ext.type === 'interurbano';
  data.lines.push(ext);
}
// HTML entities ("D&#039;Abra") and ALL CAPS names ("CANIÇAL") of the scraped text, before anything is matched by name
const cleaned = cleanTexts(data.lines);
// official positions from the Horários do Funchal GTFS feed (matched by stop code; data/gtfs/stops.json, `npm run fetch:gtfs`)
const gtfs = JSON.parse(await readFile(path.join(ROOT, 'data', 'gtfs', 'stops.json'), 'utf8'));
const gtfsStats = applyGtfs(data.lines, gtfs);
// hand-checked positions (data/stop-overrides.json) win over GTFS, SIGA and every name match below
const overridden = applyOverrides(data.lines, JSON.parse(await readFile(path.join(ROOT, 'data', 'stop-overrides.json'), 'utf8')));
// stops known only by name: borrow coordinates from stops of other routes (and feed stops) that carry the same name
const osm = JSON.parse(await readFile(path.join(ROOT, 'data', 'osm', 'stops.json'), 'utf8'));
const areas = prepareAreas(JSON.parse(await readFile(path.join(ROOT, 'data', 'osm', 'areas.json'), 'utf8')));
const coords = fillCoords(data.lines, buildStopIndex([...data.lines, gtfsAsLine(gtfs)]));
// still without a position: OpenStreetMap bus stops (data/osm/stops.json, `npm run fetch:osm`), matched by name
const osmPlaces = JSON.parse(await readFile(path.join(ROOT, 'data', 'osm', 'places.json'), 'utf8')).places;
const osmStats = applyOsm(data.lines, osm, areas, path.join(ROOT, 'data', 'shapes'), osmPlaces);
// what name matching could not place: evenly spaced along the route polyline between two known stops
const interpolated = interpolateStops(data.lines, path.join(ROOT, 'data', 'shapes'));
// timetables without a stop list: the two terminals (data/terminals.json) become the stops, so routes and estimates below apply
const terminalStops = addTerminalStops(data.lines, ROOT);
// the Funchal end of each line sits at the terminal of its operator (data/stop-overrides.json funchalTerminals), before the routes are drawn from it
const stopOverrides = JSON.parse(await readFile(path.join(ROOT, 'data', 'stop-overrides.json'), 'utf8'));
const funchalMoved = applyFunchalTerminals(data.lines, stopOverrides);
data.terminalWalks = terminalWalks(stopOverrides);
console.log('Funchal ends moved to the operator terminal:', funchalMoved, '- walking links:', JSON.stringify(data.terminalWalks));
// OSRM road routes (data/routes.json, `npm run fetch:routes`) for directions without a SIGA polyline
const routed = attachRoutes(data.lines, ROOT);
const terminalTimes = estimateTerminals(data.lines, path.join(ROOT, 'data', 'shapes'));
// intermediate stops of the terminal-only directions from the SIGA planner (data/siga-patterns.json, `npm run enrich:stops`)
const enrichReport = [];
const enriched = enrichStops(data.lines, ROOT, enrichReport);
enrichedKm(data.lines, path.join(ROOT, 'data', 'shapes'));
const plannerTimes = addPlannerDepartures(data.lines, ROOT);
console.log('directions without printed departures given the planner trips:', plannerTimes);
console.log('terminal-only directions given the planner stops:', enriched, 'of', enrichReport.length);
if (process.env.ENRICH_REPORT) for (const r of enrichReport) console.log(`  ${r.ok ? 'OK  ' : 'MISS'} ${r.line} ${r.from} > ${r.to}: ${r.why}`);
console.log('terminal-only directions given stops / routed and estimated:', terminalStops.done, '/', terminalTimes, '- terminals unknown for:', terminalStops.skipped.length);
// "Via Aeroporto"-style notes: where the place lies in each direction (the app inserts it for the trips with the note); after the routes, whose polylines tell the stretch
const viaPlaces = addViaPlaces(data.lines, osm, osmPlaces, JSON.parse(await readFile(path.join(ROOT, 'data', 'via-places.json'), 'utf8')), null, areas, path.join(ROOT, 'data', 'shapes'));
// road routes through the via places (data/via-routes.json, `npm run fetch:via-routes`), so the map line passes them
const viaRoutesFile = path.join(ROOT, 'data', 'via-routes.json');
const viaRouted = existsSync(viaRoutesFile) ? attachViaRoutes(data.lines, JSON.parse(await readFile(viaRoutesFile, 'utf8'))) : 0;
console.log('via stretches routed through their places:', viaRouted);
// precision of every position (the OSM step already set settlement_center / exact for its stops)
const precision = { exact: 0, interpolated: 0, settlement_center: 0, name_match: 0 };
for (const l of data.lines) {
  for (const d of l.directions) {
    for (const s of d.stops) {
      if (s.lat === undefined) continue;
      s.locationPrecision ??= s.isEstimatedLocation ? 'interpolated' : s.approx ? 'name_match' : 'exact';
      precision[s.locationPrecision]++;
    }
  }
}
console.log('OSRM routes attached to directions without a shape:', JSON.stringify(routed));
console.log('"Via X" notes resolved to a place:', viaPlaces, data.lines.flatMap((l) => Object.entries(l.via ?? {}).map(([c, v]) => `${l.number}:${c}=${v.map((x) => x.name).join('+')}`)).join(' '));
console.log('texts cleaned (entities, capitals):', cleaned);
console.log('reclassified urbano -> interurbano:', reclassified.length ? reclassified.join('; ') : 'none');
console.log('stop coordinates matched by name:', coords.filled, '(still without coordinates:', coords.missing + ')');
console.log('stop coordinates interpolated along the route:', interpolated);
console.log('OpenStreetMap', osm.fetched, '- stops placed by name:', JSON.stringify(osmStats));
console.log('position precision:', JSON.stringify(precision));
console.log('manual overrides (data/stop-overrides.json) applied to stops:', overridden);
console.log('GTFS', gtfs.feedVersion, '- stops by code:', JSON.stringify(gtfsStats));
console.log('municipality of stops:', JSON.stringify(assignMunicipalities(data.lines, gtfs, areas)));
await writeFile(path.join(OUT, 'data', 'schedules.json'), JSON.stringify(data));
await cp(path.join(ROOT, 'data', 'shapes'), path.join(OUT, 'data', 'shapes'), { recursive: true });
// places for the planner's autocomplete (towns, beaches, peaks, viewpoints, harbours, malls ...)
const poiFile = path.join(ROOT, 'data', 'osm', 'pois.json');
const osmPois = existsSync(poiFile) ? JSON.parse(await readFile(poiFile, 'utf8')).places : [];
const curatedPois = JSON.parse(await readFile(path.join(ROOT, 'data', 'pois-curated.json'), 'utf8')).places;
const pois = buildPois(osmPois, osmPlaces, curatedPois);
await writeFile(path.join(OUT, 'data', 'pois.json'), JSON.stringify({ places: pois }));
console.log('places for the autocomplete:', pois.length, '(OSM', osmPois.length + ', curated', curatedPois.length + ')');
// the whole network on one map: simplified line geometries, one per line
const overview = await buildOverview(data.lines, path.join(OUT, 'data', 'shapes'));
await writeFile(path.join(OUT, 'data', 'overview.json'), JSON.stringify(overview));
console.log('overview map:', overview.lines.length, 'lines,', overview.lines.reduce((n, l) => n + l.p.reduce((m, s) => m + s.length, 0), 0), 'points');
// the drawn route must leave from / arrive at the pins of the first and last stop
const snapped = await snapShapeEnds(data.lines, path.join(OUT, 'data', 'shapes'));
console.log('route lines joined to the end stops:', snapped.joined, '(gap over', snapped.maxGapM, 'm left alone:', snapped.skipped.length + ')');
console.log('estimated directions:', estimated, rejected.length ? `(rejected: ${rejected.join('; ')})` : '');
console.log('public/ updated:', data.lines.length, 'lines,', (await readdir(path.join(OUT, 'data', 'shapes'))).length, 'shapes,', local, 'local pdfs');

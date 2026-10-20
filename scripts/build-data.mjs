// Copies parsed data into public/ for the app: schedules.json, route geometries and (small) original PDFs
// of lines whose schedule could not be parsed. Everything else links to the original siga.madeira.gov.pt PDF.
import { cp, mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addEstimates } from './lib-estimate.mjs';
import { classifyLine } from './lib-classify.mjs';
import { buildStopIndex, fillCoords } from './lib-coords.mjs';
import { interpolateStops } from './lib-interpolate.mjs';
import { snapShapeEnds } from './lib-shape-ends.mjs';
import { applyOsm } from './lib-osm.mjs';
import { prepareAreas } from './lib-areas.mjs';
import { applyGtfs, assignMunicipalities, gtfsAsLine } from './lib-gtfs.mjs';

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
let estimated = 0;
const rejected = [];
for (const l of data.lines) {
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
// official positions from the Horários do Funchal GTFS feed (matched by stop code; data/gtfs/stops.json, `npm run fetch:gtfs`)
const gtfs = JSON.parse(await readFile(path.join(ROOT, 'data', 'gtfs', 'stops.json'), 'utf8'));
const gtfsStats = applyGtfs(data.lines, gtfs);
// stops known only by name: borrow coordinates from stops of other routes (and feed stops) that carry the same name
const osm = JSON.parse(await readFile(path.join(ROOT, 'data', 'osm', 'stops.json'), 'utf8'));
const areas = prepareAreas(JSON.parse(await readFile(path.join(ROOT, 'data', 'osm', 'areas.json'), 'utf8')));
const coords = fillCoords(data.lines, buildStopIndex([...data.lines, gtfsAsLine(gtfs)]));
// still without a position: OpenStreetMap bus stops (data/osm/stops.json, `npm run fetch:osm`), matched by name
const osmPlaces = JSON.parse(await readFile(path.join(ROOT, 'data', 'osm', 'places.json'), 'utf8')).places;
const osmStats = applyOsm(data.lines, osm, areas, path.join(ROOT, 'data', 'shapes'), osmPlaces);
// what name matching could not place: evenly spaced along the route polyline between two known stops
const interpolated = interpolateStops(data.lines, path.join(ROOT, 'data', 'shapes'));
console.log('reclassified urbano -> interurbano:', reclassified.length ? reclassified.join('; ') : 'none');
console.log('stop coordinates matched by name:', coords.filled, '(still without coordinates:', coords.missing + ')');
console.log('stop coordinates interpolated along the route:', interpolated);
console.log('OpenStreetMap', osm.fetched, '- stops placed by name:', JSON.stringify(osmStats));
console.log('GTFS', gtfs.feedVersion, '- stops by code:', JSON.stringify(gtfsStats));
console.log('municipality of stops:', JSON.stringify(assignMunicipalities(data.lines, gtfs, areas)));
await writeFile(path.join(OUT, 'data', 'schedules.json'), JSON.stringify(data));
await cp(path.join(ROOT, 'data', 'shapes'), path.join(OUT, 'data', 'shapes'), { recursive: true });
// the drawn route must leave from / arrive at the pins of the first and last stop
const snapped = await snapShapeEnds(data.lines, path.join(OUT, 'data', 'shapes'));
console.log('route lines joined to the end stops:', snapped.joined, '(gap over', snapped.maxGapM, 'm left alone:', snapped.skipped.length + ')');
console.log('estimated directions:', estimated, rejected.length ? `(rejected: ${rejected.join('; ')})` : '');
console.log('public/ updated:', data.lines.length, 'lines,', (await readdir(path.join(OUT, 'data', 'shapes'))).length, 'shapes,', local, 'local pdfs');

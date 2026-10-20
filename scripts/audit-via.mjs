// Audit of every "Via ..." note of every timetable: which are places the bus calls at (resolved to a position and inserted into
// the trips that carry the note), which are corridors ("Via Rápida") that stay a label, and which could not be placed (and why).
// Usage: node scripts/audit-via.mjs [--json]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addViaPlaces } from './lib-via.mjs';
import { prepareAreas } from './lib-areas.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = async (f) => JSON.parse(await readFile(path.join(ROOT, f), 'utf8'));
const data = await rd('public/data/schedules.json');
const report = [];
for (const l of data.lines) delete l.via;
addViaPlaces(data.lines, await rd('data/osm/stops.json'), (await rd('data/osm/places.json')).places, await rd('data/via-places.json'), report, prepareAreas(await rd('data/osm/areas.json')), path.join(ROOT, 'data', 'shapes'));

const byStatus = {};
const places = new Map();
for (const r of report) {
  (byStatus[r.status] ??= []).push(r);
  if (r.name) {
    const p = places.get(r.name.toLowerCase()) ?? places.set(r.name.toLowerCase(), { name: r.name, status: new Set(), lines: [] }).get(r.name.toLowerCase());
    p.status.add(r.status);
    p.lines.push(`${r.line}:${r.code}`);
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 1));
else {
  console.log(`"Via ..." notes: ${report.length}, distinct places: ${places.size}`);
  for (const [s, list] of Object.entries(byStatus)) console.log(`  ${s}: ${list.length}`);
  for (const [s, list] of Object.entries(byStatus)) {
    console.log(`\n== ${s}`);
    const seen = new Set();
    for (const r of list) {
      const k = r.name ?? r.text;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`  ${(r.name ?? r.text).slice(0, 70).padEnd(50)} ${list.filter((x) => (x.name ?? x.text) === k).map((x) => `${x.line}:${x.code}`).join(' ')}`);
    }
  }
}

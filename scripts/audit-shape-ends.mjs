// Checks that the drawn polyline of every direction starts at its first and ends at its last stop (the pins on the map).
// Needs public/data (npm run build:data). Usage: node scripts/audit-shape-ends.mjs [maxGapMetres]
import { existsSync, readFileSync } from 'node:fs';
import { haversineM } from '../shared/geo.mjs';
const MAX = +(process.argv[2] ?? 60);
const data = JSON.parse(readFileSync(new URL('../public/data/schedules.json', import.meta.url), 'utf8'));
const hav = haversineM;
let n = 0;
const bad = [];
for (const l of data.lines) {
  for (const [i, d] of l.directions.entries()) {
    const f = new URL(`../public/data/shapes/${d.shapeId}.json`, import.meta.url);
    if (d.shapeId == null || !existsSync(f)) continue;
    const poly = JSON.parse(readFileSync(f, 'utf8'));
    const placed = d.stops.filter((s) => s.lat !== undefined);
    if (!placed.length) continue;
    n++;
    const a = placed[0];
    const b = placed.at(-1);
    const d0 = hav([a.lat, a.lon], poly[0]);
    const d1 = hav([b.lat, b.lon], poly.at(-1));
    if (d0 > MAX || d1 > MAX) bad.push(`${l.number} dir ${i}: start ${Math.round(d0)} m, end ${Math.round(d1)} m`);
  }
}
console.log(`${n} directions checked, ${bad.length} with a gap over ${MAX} m`);
for (const x of bad) console.log(' ', x);

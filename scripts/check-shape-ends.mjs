// Reports routes whose drawn polyline does not start/end at the first/last stop (default tolerance 30 m).
// Usage: node scripts/check-shape-ends.mjs [toleranceMetres]   (reads public/data after `npm run build:data`)
import { readFileSync, existsSync } from 'node:fs';
import { metres } from '../shared/geo.mjs';
const tol = +(process.argv[2] ?? 30);
const root = new URL('../public/data/', import.meta.url);
const data = JSON.parse(readFileSync(new URL('schedules.json', root), 'utf8'));
const m = metres;
let checked = 0;
const bad = [];
for (const l of data.lines) {
  l.directions.forEach((d, i) => {
    if (d.shapeId == null || !d.stops.length) return;
    const f = new URL(`shapes/${d.shapeId}.json`, root);
    if (!existsSync(f)) return;
    const poly = JSON.parse(readFileSync(f, 'utf8'));
    const a = d.stops[0];
    const b = d.stops[d.stops.length - 1];
    checked++;
    const ds = a.lat === undefined ? null : m([a.lat, a.lon], poly[0]);
    const de = b.lat === undefined ? null : m([b.lat, b.lon], poly[poly.length - 1]);
    if ((ds ?? 0) > tol || (de ?? 0) > tol) bad.push(`${l.number}/${i} ${a.name} -> ${b.name}: start ${ds?.toFixed(0)} m, end ${de?.toFixed(0)} m`);
  });
}
console.log(`${checked} directions with a shape, ${bad.length} beyond ${tol} m`);
for (const x of bad) console.log(' ', x);
process.exit(bad.length ? 1 : 0);

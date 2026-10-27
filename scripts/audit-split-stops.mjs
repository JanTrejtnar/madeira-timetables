// Split-stop audit: one physical stop that the data keeps as two stops because of the spelling or of the source
// ("P.Cruz" on line 208 vs "Porto da Cruz" on line 56) - the position is then known on one line and missing or only
// estimated on the other. Lists, across all lines, pairs of stops within 150 m that
//   (a) abbreviation: the same key after abbreviations are resolved (lib-abbrev), printed differently, or
//   (b) spelling: different keys with the same set of key words, or
//   (c) near-name: the words of one name are all in the other, one position is exact / name_match and the other is estimated or missing.
// `npm run audit:split-stops` after build:data (build:data prints it too); it only reports, the data is not changed.
import { readFileSync } from 'node:fs';
import { keyOf, normName, tokens } from './lib-coords.mjs';

const R = 6371.0088;
const rad = Math.PI / 180;
const hav = (a, b) => {
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1000;
};
/** the printed name without the direction marker, abbreviations NOT resolved */
const plain = (n) => normName(n).replace(/ (d|s)\d*[a-z]?$/, '').replace(/ t \d+$/, '');
const good = (p) => p.prec === 'exact' || p.prec === 'name_match' || p.prec === 'manual_osm_match';
const weak = (e) => e.missing || e.pts.every((p) => !good(p));

export function splitStops(schedules) {
  const byName = new Map(); // printed name -> { name, key, lines:Set, p, precision }
  for (const l of schedules.lines)
    for (const d of l.directions)
      for (const s of d.stops) {
        if (s.via) continue;
        const e = byName.get(s.name) ?? { name: s.name, key: keyOf(s.name), lines: new Set(), pts: [] };
        e.lines.add(l.number);
        if (s.lat !== undefined) e.pts.push({ lat: s.lat, lon: s.lon, prec: s.locationPrecision ?? 'exact' });
        else e.missing = true;
        byName.set(s.name, e);
      }
  const list = [...byName.values()];
  const found = [];
  const seen = new Set();
  const push = (kind, a, b, m) => {
    const id = [kind, a.name, b.name].sort().join('|');
    if (!seen.has(id)) { seen.add(id); found.push({ kind, a: a.name, b: b.name, metres: m, problem: weak(a) !== weak(b),  linesA: [...a.lines], linesB: [...b.lines] }); }
  };
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const sameKey = a.key === b.key;
      const ta = new Set(tokens(a.key)), tb = new Set(tokens(b.key));
      const sameWords = !sameKey && ta.size > 0 && ta.size === tb.size && [...ta].every((w) => tb.has(w));
      const subset = !sameKey && !sameWords && ta.size > 0 && tb.size > 0 && [...tokens(a.key).join('')].length >= 5 && [...tokens(b.key).join('')].length >= 5 && ([...ta].every((w) => tb.has(w)) || [...tb].every((w) => ta.has(w)));
      if (!sameKey && !sameWords && !subset) continue;
      let m = Infinity; // nearest pair of positions
      for (const p of a.pts) for (const q of b.pts) m = Math.min(m, hav(p, q));
      const noPos = (!a.pts.length && a.missing) || (!b.pts.length && b.missing);
      if (m > 150 && !noPos) continue;
      if (sameKey && plain(a.name) !== plain(b.name)) push('abbreviation', a, b, m);
      else if (sameWords) push('spelling', a, b, m);
      else if (subset && (weak(a) !== weak(b))) push('near-name', a, b, m);
    }
  return found;
}

/** prints the summary and the one-sided pairs of public/data/schedules.json (returns them) */
export function printSplitStops() {
  const found = splitStops(JSON.parse(readFileSync('public/data/schedules.json', 'utf8')));
  const problems = found.filter((f) => f.problem);
  console.log(`split stops: ${found.length} pairs of one place printed differently (within 150 m), ${problems.length} of them with a position known on one side only (exact / name_match vs estimate or none):`);
  for (const f of problems) console.log(`  ${f.kind.padEnd(12)} "${f.a}" (${f.linesA.join(',')}) ~ "${f.b}" (${f.linesB.join(',')}) ${Number.isFinite(f.metres) ? Math.round(f.metres) + ' m' : 'no position'}`);
  return problems;
}

if (process.argv[1]?.endsWith('audit-split-stops.mjs')) printSplitStops();

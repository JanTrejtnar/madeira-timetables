// Corridor matcher for the stops that still have no coordinates (data/missing-stops.json).
// A stop lies on known lines, so its previous and next stop with a position are known: the real stop must sit in a narrow
// corridor around the road between them. OSM stops / places (data/osm) inside that corridor are ranked by name similarity
// and by distance from the route axis; the chosen one is written to data/stop-overrides.json.
//
//   node scripts/match-corridor-stops.mjs            interactive (a TTY), else a report
//   node scripts/match-corridor-stops.mjs --report   only print the context and the candidates
//   node scripts/match-corridor-stops.mjs --auto     assign the single candidate with name similarity > 80 % within 500 m of the axis
//   --only "Name"      limit to stops whose name contains the text (repeatable)
//   --accept "Name=ID" write the candidate OSM node ID (or place:<name>) found in the corridor of the stop
//   --interp "Name"    write the point on the road at the ratio of the driving times between the neighbours (interpolated_road_point)
//   --limit N          look at the first N stops of the list only
//   --dry              with --auto / --accept / --interp: print what would be written, change nothing
// Needs `npm run build:data` first (it reads public/data). Run `npm run build:data` afterwards.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import readline from 'node:readline/promises';
import { canon } from './lib-osm.mjs';
import { GENERIC, keyOf, tokens } from './lib-coords.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const values = (n) => args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]] : []));
const AUTO = flag('--auto');
const REPORT = flag('--report');
const DRY = flag('--dry');
const ONLY = values('--only').map(keyOf);
const ACCEPT = new Map(values('--accept').map((v) => [keyOf(v.slice(0, v.lastIndexOf('='))), v.slice(v.lastIndexOf('=') + 1)]));
const INTERP = new Set(values('--interp').map(keyOf));
const LIMIT = Number(values('--limit')[0] ?? Infinity);

const SIDE_KM = 1.5; // corridor half-width around the route axis
const END_KM = 5; // a stop beyond the last known stop of a line: only that neighbour is known, so the corridor is a circle
const AUTO_AXIS_KM = 0.5;
const AUTO_SIM = 0.8;
const LIST_SIM = 0.4;
const MAX_SNAP_KM = 0.35;
const SAME_PLACE_KM = 0.25;

const R = 6371.0088;
const rad = Math.PI / 180;
function hav(a, b) {
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const has = (s) => s.lat !== undefined && s.lon !== undefined;

/** Distance (km) from p to the segment a-b, in a local flat projection. */
function distToSegment(p, a, b) {
  const kx = 111.32 * Math.cos(p[0] * rad);
  const ky = 110.54;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky;
  const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
const distToPath = (poly, p) => {
  let d = Infinity;
  for (let i = 1; i < poly.length; i++) d = Math.min(d, distToSegment(p, poly[i - 1], poly[i]));
  return poly.length === 1 ? hav(poly[0], p) : d;
};

// ---- name similarity -------------------------------------------------------------------------------------------
const ABBR = { c: 'centro', rot: 'rotunda', st: 'santa', s: 'sao', sta: 'santa', rib: 'ribeira', ribª: 'ribeira', p: 'ponta', f: 'faja', ach: 'achada', ig: 'igreja', cem: 'cemiterio', cs: 'centro saude', saude: 'saude', encum: 'encumeada' };
const words = (name) => tokens(keyOf(canon(name))).flatMap((w) => (ABBR[w] ?? w).split(' '));
function lev(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
function wordSim(a, b) {
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)) && Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.75) return 0.9; // "Serra" is not "Serrado"
  const r = 1 - lev(a, b) / Math.max(a.length, b.length);
  return r >= 0.8 ? r : 0;
}
/** 0..1: how many of the words of each name are found in the other (averaged, so extra words on either side cost). */
export function nameSimilarity(a, b) {
  const wa = words(a), wb = words(b);
  if (!wa.length || !wb.length) return 0;
  const cover = (x, y) => x.reduce((s, w) => s + Math.max(...y.map((v) => wordSim(w, v))), 0) / x.length;
  return (cover(wa, wb) + cover(wb, wa)) / 2;
}

// ---- data ------------------------------------------------------------------------------------------------------
const schedules = JSON.parse(readFileSync('public/data/schedules.json', 'utf8'));
const missingList = JSON.parse(readFileSync('data/missing-stops.json', 'utf8')).missing;
const osm = JSON.parse(readFileSync('data/osm/stops.json', 'utf8')).stops;
const places = JSON.parse(readFileSync('data/osm/places.json', 'utf8')).places;
const cand = [
  ...osm.flatMap((s) => [s.name, s.alt].filter(Boolean).map((name) => ({ kind: 'stop', id: s.id, name, p: [s.lat, s.lon] }))),
  ...places.map((s) => ({ kind: 'place', id: `place:${s.name}`, name: s.name, p: [s.lat, s.lon], place: s.place })),
];
const shapeCache = new Map();
function shapeOf(id) {
  if (id == null) return null;
  if (!shapeCache.has(id)) {
    const f = [`public/data/shapes/${id}.json`, `data/shapes/${id}.json`].find(existsSync);
    shapeCache.set(id, f ? JSON.parse(readFileSync(f, 'utf8')) : null);
  }
  return shapeCache.get(id);
}
const toMin = (t) => (typeof t === 'string' && /^\d+:\d\d/.test(t) ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);

/** Every direction in which the stop has no position: its known neighbours, the road between them, the timetable ratio. */
function contextsOf(name) {
  const out = [];
  for (const l of schedules.lines) {
    for (const d of l.directions) {
      const idx = d.stops.findIndex((s) => s.name === name && !has(s) && !s.via);
      if (idx < 0) continue;
      const known = d.stops.map((s, i) => [s, i]).filter(([s]) => has(s) && !s.via);
      const prev = known.filter(([, i]) => i < idx).at(-1);
      const next = known.find(([, i]) => i > idx);
      if (!prev && !next) continue;
      const A = prev?.[0], B = next?.[0];
      const ends = [A, B].filter(Boolean).map((s) => [s.lat, s.lon]);
      let axis = ends;
      let km = null; // the road polyline between the neighbours, when the direction has a drawn route
      let ratio = null;
      const poly = shapeOf(d.shapeId);
      if (poly && A && B) {
        const cum = [0];
        for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + hav(poly[i - 1], poly[i]));
        const snap = (p, from) => {
          let best = -1, bd = Infinity;
          for (let i = from; i < poly.length; i++) { const x = hav(poly[i], p); if (x < bd) { bd = x; best = i; } }
          return { i: best, d: bd };
        };
        const sa = snap([A.lat, A.lon], 0);
        const sb = sa.d <= MAX_SNAP_KM ? snap([B.lat, B.lon], sa.i) : null;
        if (sb && sb.d <= MAX_SNAP_KM && sb.i > sa.i) {
          axis = poly.slice(sa.i, sb.i + 1);
          km = { poly, cum, from: sa.i, to: sb.i };
        }
      }
      if (A && B) {
        const rs = (d.trips ?? []).map((t) => {
          const [ta, tc, tb] = [prev[1], idx, next[1]].map((i) => toMin(t.times?.[i]));
          return ta != null && tc != null && tb != null && tb > ta ? (tc - ta) / (tb - ta) : null;
        }).filter((x) => x != null).sort((a, b) => a - b);
        ratio = rs.length ? rs[rs.length >> 1] : (idx - prev[1]) / (next[1] - prev[1]);
      }
      out.push({ tol: A && B ? SIDE_KM : END_KM, line: l.number, dir: `${d.from} → ${d.to}`, prev: A, next: B, axis, km, ratio, gap: A && B ? next[1] - prev[1] - 1 : null,
        len: km ? (km.cum[km.to] - km.cum[km.from]) : A && B ? hav([A.lat, A.lon], [B.lat, B.lon]) : null });
    }
  }
  return out;
}

/** Candidates in the corridor of every context, best first. */
function candidatesFor(name, ctxs) {
  const rows = [];
  for (const c of cand) {
    const sim = nameSimilarity(name, c.name);
    if (sim < LIST_SIM) continue;
    const dists = ctxs.map((x) => distToPath(x.axis, c.p));
    if (dists.some((d, i) => d > ctxs[i].tol)) continue;
    rows.push({ ...c, sim, axisKm: Math.max(...dists) });
  }
  rows.sort((a, b) => b.sim - a.sim || a.axisKm - b.axisKm);
  // two platforms of one stop (both sides of the road) are one candidate: keep the one nearest the axis
  const kept = [];
  for (const r of rows) {
    const same = kept.find((k) => k.sim === r.sim && hav(k.p, r.p) < SAME_PLACE_KM);
    if (!same) kept.push(r);
    else if (r.axisKm < same.axisKm) kept[kept.indexOf(same)] = r;
  }
  return kept.slice(0, 9);
}

function interpolatePoint(ctxs) {
  const x = ctxs.find((c) => c.km && c.ratio != null);
  if (!x) return null;
  const { poly, cum, from, to } = x.km;
  const target = cum[from] + (cum[to] - cum[from]) * x.ratio;
  let i = from + 1;
  while (i < to && cum[i] < target) i++;
  const span = cum[i] - cum[i - 1] || 1;
  const f = Math.min(1, Math.max(0, (target - cum[i - 1]) / span));
  return { p: [+(poly[i - 1][0] + (poly[i][0] - poly[i - 1][0]) * f).toFixed(6), +(poly[i - 1][1] + (poly[i][1] - poly[i - 1][1]) * f).toFixed(6)], from: x };
}

// ---- overrides file ---------------------------------------------------------------------------------------------
const OVERRIDES = 'data/stop-overrides.json';
const rawOverrides = readFileSync(OVERRIDES, 'utf8');
const CRLF = rawOverrides.includes('\r\n');
const overrides = JSON.parse(rawOverrides);
function save() {
  const text = JSON.stringify(overrides, null, 2) + '\n';
  writeFileSync(OVERRIDES, CRLF ? text.replace(/\n/g, '\r\n') : text);
}
function writeOverride(name, ctxs, entry) {
  const lines = [...new Set(ctxs.map((c) => c.line))].sort();
  const o = { name, label: entry.label, lines, lat: entry.p[0], lon: entry.p[1], ...(entry.osmNode ? { osmNode: entry.osmNode } : {}), locationPrecision: entry.precision };
  const key = keyOf(name);
  const at = overrides.overrides.findIndex((x) => keyOf(x.name) === key && JSON.stringify([...(x.lines ?? [])].sort()) === JSON.stringify(lines));
  if (at >= 0) overrides.overrides[at] = o;
  else overrides.overrides.push(o);
  save();
}
const around = (ctxs) => ctxs.map((c) => `line ${c.line} between ${c.prev ? `${c.prev.name}` : '(start)'} and ${c.next ? c.next.name : '(end)'}`).join('; ');
function candidateEntry(name, ctxs, c, how) {
  const kind = c.kind === 'stop' ? `OSM stop ${c.id} "${c.name}"` : `OSM place "${c.name}" (${c.place}, village centre)`;
  return {
    p: c.p,
    osmNode: c.kind === 'stop' ? c.id : undefined,
    precision: 'corridor_osm_match',
    label: `CORRIDOR MATCH, NOT AN OFFICIAL SIGA POSITION (${how}): ${around(ctxs)}; ${kind} ${Math.round(c.axisKm * 1000)} m from the route axis, name similarity ${Math.round(c.sim * 100)} %. Generated by scripts/match-corridor-stops.mjs.`,
  };
}
function interpEntry(name, ctxs) {
  const r = interpolatePoint(ctxs);
  if (!r) return null;
  return {
    p: r.p,
    precision: 'interpolated_road_point',
    label: `INTERPOLATED ON THE ROAD, NOT A SURVEYED STOP: ${around([r.from])}, at ${Math.round(r.from.ratio * 100)} % of the driving time between them along the drawn route (no OSM stop of this name in the corridor). Generated by scripts/match-corridor-stops.mjs.`,
  };
}

// ---- main -------------------------------------------------------------------------------------------------------
const fmtKm = (k) => (k == null ? '?' : `${k.toFixed(1)} km`);
function show(s, ctxs, cs) {
  console.log(`\nZastávka: "${s.name}" (linka ${s.lines.join(', ')}; ${s.tripCount} spojů)`);
  for (const c of ctxs) {
    const gap = c.gap ? `, ${c.gap} zastávek bez polohy mezi nimi` : '';
    console.log(`  ${c.line} ${c.dir}: ${c.prev?.name ?? '—'} <-> ${c.next?.name ?? '—'}  (trasa ${fmtKm(c.len)}${c.ratio != null ? `, ${Math.round(c.ratio * 100)} % jízdní doby` : ''}${gap})`);
  }
  const exp = interpolatePoint(ctxs);
  if (exp) console.log(`  očekávaná poloha podle jízdní doby: ${exp.p.join(', ')}`);
  console.log('Kandidáti v koridoru:');
  if (!cs.length) console.log('  (žádný)');
  cs.forEach((c, i) => console.log(`  [${i + 1}] ${c.kind === 'stop' ? `OSM node ${c.id}` : 'OSM místo'}: "${c.name}" (shoda ${Math.round(c.sim * 100)} %, ${Math.round(c.axisKm * 1000)} m od trasy${exp ? `, ${Math.round(hav(exp.p, c.p) * 1000)} m od očekávané polohy` : ''})`));
}

const todo = missingList.filter((s) => !ONLY.length || ONLY.some((k) => keyOf(s.name).includes(k))).slice(0, LIMIT);
const tty = process.stdin.isTTY && !AUTO && !REPORT && !ACCEPT.size && !INTERP.size;
const rl = tty ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
const done = { matched: 0, interpolated: 0, skipped: 0 };
for (const s of todo) {
  const ctxs = contextsOf(s.name);
  if (!ctxs.length) { console.log(`\n"${s.name}": no known neighbour on any line, skipped`); done.skipped++; continue; }
  const cs = candidatesFor(s.name, ctxs);
  const key = keyOf(s.name);
  if (ACCEPT.has(key)) {
    const id = ACCEPT.get(key);
    const c = cs.find((x) => String(x.id) === id) ?? cand.map((x) => ({ ...x, sim: nameSimilarity(s.name, x.name), axisKm: Math.max(...ctxs.map((k) => distToPath(k.axis, x.p))) })).find((x) => String(x.id) === id && x.axisKm <= SIDE_KM || ctxs.some((k) => !k.prev || !k.next));
    if (!c) { console.log(`\n"${s.name}": candidate ${id} is not in the corridor`); done.skipped++; continue; }
    writeOverride(s.name, ctxs, candidateEntry(s.name, ctxs, c, 'accepted by id'));
    console.log(`\n"${s.name}": ${c.name} (${c.id}) written`); done.matched++; continue;
  }
  if (INTERP.has(key)) {
    const e = interpEntry(s.name, ctxs);
    if (!e) { console.log(`\n"${s.name}": no drawn route between the neighbours, cannot interpolate`); done.skipped++; continue; }
    writeOverride(s.name, ctxs, e);
    console.log(`\n"${s.name}": interpolated to ${e.p.join(', ')}`); done.interpolated++; continue;
  }
  if (AUTO) {
    // a town name (Machico, Calheta) names too many stops to place one by it
    const strong = GENERIC.has(keyOf(canon(s.name))) ? [] : cs.filter((c) => c.sim > AUTO_SIM && c.axisKm <= AUTO_AXIS_KM);
    if (strong.length === 1) {
      writeOverride(s.name, ctxs, candidateEntry(s.name, ctxs, strong[0], 'auto, single high-confidence candidate'));
      console.log(`\n"${s.name}" <- "${strong[0].name}" (${Math.round(strong[0].sim * 100)} %, ${Math.round(strong[0].axisKm * 1000)} m) [auto]`); done.matched++;
    } else { console.log(`\n"${s.name}": ${strong.length ? `${strong.length} strong candidates` : 'no strong candidate'}, left`); done.skipped++; }
    continue;
  }
  show(s, ctxs, cs);
  if (!rl) continue;
  const ans = (await rl.question(`Volba [1-${cs.length}/i = interpolovat/s = přeskočit/q = konec]: `)).trim().toLowerCase();
  if (ans === 'q') break;
  if (ans === 'i') {
    const e = interpEntry(s.name, ctxs);
    if (e) { writeOverride(s.name, ctxs, e); done.interpolated++; } else { console.log('žádná nakreslená trasa mezi sousedy'); done.skipped++; }
  } else if (/^\d+$/.test(ans) && cs[+ans - 1]) { writeOverride(s.name, ctxs, candidateEntry(s.name, ctxs, cs[+ans - 1], 'interactive')); done.matched++; }
  else done.skipped++;
}
rl?.close();
console.log(`\ncorridor matcher: ${done.matched} matched, ${done.interpolated} interpolated, ${done.skipped} left (${todo.length} stops looked at). Run npm run build:data.`);

// Places the terminals of timetables that print no stop list (data/terminals.json) which are not hand-checked yet.
// A terminal name is searched in OpenStreetMap (data/osm: highway=bus_stop first, then the place of that name) only near where the
// line runs: within RADIUS_KM of the other end of the line (or of its municipality), on the operator's side of the island, and
// never on Porto Santo for a Madeira line. A name with one answer there is written as an `auto` entry; a name with several far-apart
// answers, no answer, or a compound name ("Funchal - Preces - Caldeira") is left for hand curation and listed.
// `npm run resolve:terminals` (offline; the place of a village is snapped to the road with OSRM when reachable), then `npm run build:data`.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyOf, GENERIC } from './lib-coords.mjs';
import { findTerminal } from './lib-terminals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'terminals.json');
const RADII_KM = [12, 25]; // a village is first looked for near the line's other end, then in a wider ring (long lines)
const CLUSTER_M = 300;
const OSRM = process.env.OSRM_URL ?? 'https://router.project-osrm.org';
/** printed abbreviations -> the name searched in OSM (and shown as the stop name) */
const ALIASES = {
  'estreito c lobos': 'Estreito de Câmara de Lobos',
  'serra agua': 'Serra de Água',
  centro: 'Vila Baleira',
};

const rad = Math.PI / 180;
const km = (a, b) => Math.hypot((a.lon - b.lon) * 111.32 * Math.cos(((a.lat + b.lat) / 2) * rad), (a.lat - b.lat) * 110.54);
const FUNCHAL = { lat: 32.6475, lon: -16.907 };
const inPortoSanto = (p) => p.lat > 32.95;
const read = (f) => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));

const sched = read('data/schedules.json');
const osmStops = read('data/osm/stops.json').stops.filter((s) => s.name).map((s) => ({ ...s, key: keyOf(s.name) }));
const places = read('data/osm/places.json').places.map((p) => ({ ...p, key: keyOf(p.name) }));
const areas = read('data/osm/areas.json').areas.filter((a) => a.level === 7);
const file = read('data/terminals.json');
// auto entries are rebuilt on every run, hand-checked ones are never touched
const terminals = {};
for (const [k, v] of Object.entries(file.terminals)) {
  const keep = (Array.isArray(v) ? v : [v]).filter((e) => !e.auto);
  if (keep.length) terminals[k] = keep.length === 1 ? keep[0] : keep;
}

const centre = (muni) => {
  const a = areas.find((x) => keyOf(x.name) === keyOf(muni ?? ''));
  if (!a) return null;
  const pts = a.rings.flat();
  const ys = pts.map((p) => p[0]);
  const xs = pts.map((p) => p[1]);
  return { lat: (Math.min(...ys) + Math.max(...ys)) / 2, lon: (Math.min(...xs) + Math.max(...xs)) / 2 };
};

// the stop-less directions with the two printed ends
const items = [];
for (const l of sched.lines) {
  if (!l.hasParsedSchedule) continue;
  for (const d of l.directions) if (!d.stops.length && d.from && d.to) items.push({ line: l, from: d.from.replace(/�/g, ''), to: d.to.replace(/�/g, '') });
}
const pending = new Map(); // `${line}|${key}` -> { line, name }
for (const it of items) for (const n of [it.from, it.to]) if (!findTerminal(terminals, it.line, n)) pending.set(`${it.line.number}|${keyOf(n)}`, { line: it.line, name: n });

const regionOk = (line, p) => {
  if ((line.municipality === 'Porto Santo') !== inPortoSanto(p)) return false;
  if (line.family === 'rod' && p.lon > -16.88) return false;
  return true;
};
const clusters = (list) => {
  const out = [];
  for (const c of list) {
    const g = out.find((o) => o.some((m) => km(m, c) * 1000 <= CLUSTER_M));
    if (g) g.push(c);
    else out.push([c]);
  }
  return out;
};
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s(.-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das)\b/g, (w) => w.toLowerCase());

/** the OSM object of a printed terminal name near `anchor`: { point, display, label, place } | { reason } */
function search(line, name, anchor, radius) {
  const alias = ALIASES[keyOf(name)];
  const want = keyOf(alias ?? name);
  const near = (p) => regionOk(line, p) && (GENERIC.has(want) || !anchor || km(p, anchor) <= radius);
  const tiers = [
    GENERIC.has(want) ? { list: places.filter((p) => p.key === want && (p.place === 'city' || p.place === 'town') && regionOk(line, p)), kind: 'OSM town', place: true } : null,
    { list: osmStops.filter((s) => s.key === want && near(s)), kind: 'OSM bus stop', place: false },
    { list: places.filter((p) => p.key === want && near(p)), kind: 'OSM place', place: true },
    { list: osmStops.filter((s) => s.key.startsWith(want + ' ') && near(s)), kind: 'OSM bus stop (name starts with it)', place: false },
  ].filter(Boolean);
  for (const { list, kind, place } of tiers) {
    if (!list.length) continue;
    const dist = (g) => (anchor ? Math.min(...g.map((m) => km(m, anchor))) : 0);
    const groups = clusters(list).sort((a, b) => dist(a) - dist(b));
    // several far-apart answers: only the clearly nearest one (less than half the distance of the next) is taken
    if (groups.length > 1 && !(dist(groups[1]) > 2 * dist(groups[0]) + 0.5)) return { reason: `ambiguous, ${groups.length} candidates (${groups.map((g) => `${g[0].lat},${g[0].lon}`).join(' | ')})` };
    const m = [...groups[0]].sort((a, b) => (anchor ? km(a, anchor) - km(b, anchor) : 0))[0];
    return { point: { lat: m.lat, lon: m.lon }, display: (alias ?? (!/\p{Lu}{3,}/u.test(name) ? name : place ? m.name : titleCase(name))) + (line.municipality === 'Porto Santo' && places.some((p) => p.key === want && !inPortoSanto(p)) ? ' (Porto Santo)' : ''), exact: !place, label: `${kind} ${m.name}${m.id ? ` (node ${m.id})` : ''}${anchor ? `, within ${radius} km of the other end of the line / its municipality` : ''}`, place };
  }
  return { reason: 'not found in OSM near the line' };
}

async function snap(p) {
  try {
    const r = await fetch(`${OSRM}/nearest/v1/driving/${p.lon},${p.lat}`, { signal: AbortSignal.timeout(15000) });
    const w = (await r.json()).waypoints?.[0];
    if (w && km({ lat: w.location[1], lon: w.location[0] }, p) < 0.3) return { lat: +w.location[1].toFixed(6), lon: +w.location[0].toFixed(6) };
  } catch {
    /* offline: keep the OSM position */
  }
  return p;
}

const found = new Map(); // `${line}|${key}` -> search result
const endPoint = (line, name) => {
  const hit = findTerminal(terminals, line, name) ?? found.get(`${line.number}|${keyOf(name)}`)?.point;
  return hit ? { lat: hit.lat, lon: hit.lon } : null;
};
for (let pass = 0; pass < 3; pass++) {
  for (const [id, it] of pending) {
    if (found.get(id)?.point) continue;
    // every other end of this name on the same line, as far as it is placed; the last pass falls back to the middle of the municipality
    const others = items.filter((x) => x.line === it.line && [x.from, x.to].some((n) => keyOf(n) === keyOf(it.name))).map((x) => (keyOf(x.from) === keyOf(it.name) ? x.to : x.from));
    let anchors = [...new Set(others)].map((o) => endPoint(it.line, o)).filter(Boolean);
    // wait until the other ends are placed; the last pass also checks the name against the middle of the line's municipality
    if (pass < 2 && anchors.length < new Set(others).size) continue;
    if (pass === 2) anchors = [...anchors, centre(it.line.municipality)].filter(Boolean);
    // Funchal has namesakes of every village (Moinhos, Torre, São João): next to a better anchor it is ignored
    const strong = anchors.filter((a) => km(a, FUNCHAL) > 2);
    if (strong.length) anchors = strong;
    if (!anchors.length && !GENERIC.has(keyOf(ALIASES[keyOf(it.name)] ?? it.name))) continue;
    const hits = [];
    let failure = { reason: 'not found in OSM near the line' };
    for (const anchor of anchors.length ? anchors : [null]) {
      for (const radius of RADII_KM) {
        const r = search(it.line, it.name, anchor, radius);
        // plausibility: the two ends of a line are neither on top of each other nor on opposite sides of the island
        if (r.point && anchor && (km(anchor, r.point) < 0.2 || km(anchor, r.point) > 45)) { failure = { reason: `implausible distance to the other end: ${km(anchor, r.point).toFixed(1)} km` }; break; }
        if (r.point) {
          hits.push(r);
          break;
        }
        failure = r;
        if (r.reason.startsWith('ambiguous')) break;
      }
    }
    // the other ends of the line must agree on one place (Funchal alone would pick one of its own neighbourhoods named Moinhos)
    const disagree = hits.some((h) => km(h.point, hits[0].point) * 1000 > CLUSTER_M);
    found.set(id, disagree ? { reason: `the ends of the line point to different places (${hits.map((h) => `${h.point.lat},${h.point.lon}`).join(' | ')})` } : hits[0] ?? failure);
  }
}

const unresolved = [];
const entries = new Map();
for (const [id, it] of pending) {
  const r = found.get(id) ?? { reason: 'no anchor (the other end is unknown too)' };
  if (!r.point) { unresolved.push(`${it.line.number}: ${it.name} - ${r.reason}`); continue; }
  const pos = r.place ? await snap(r.point) : r.point;
  const key = keyOf(it.name);
  const at = `${key}|${pos.lat},${pos.lon}`;
  const e = entries.get(at) ?? { key, entry: { name: r.display, lat: pos.lat, lon: pos.lon, lines: [], auto: true, ...(r.exact ? { precision: 'exact' } : {}), label: r.label } };
  if (!e.entry.lines.includes(it.line.number)) e.entry.lines.push(it.line.number);
  entries.set(at, e);
}
for (const { key, entry } of entries.values()) {
  const cur = terminals[key];
  terminals[key] = cur ? [...(Array.isArray(cur) ? cur : [cur]), entry] : entry;
}

const ser = (e) => JSON.stringify(e).replace(/"(\w+)":/g, '"$1": ').replace(/,"/g, ', "').replace(/^\{/, '{ ').replace(/\}$/, ' }');
const body = Object.entries(terminals).map(([k, v]) => (Array.isArray(v) ? `    ${JSON.stringify(k)}: [\n${v.map((e) => `      ${ser(e)}`).join(',\n')}\n    ]` : `    ${JSON.stringify(k)}: ${ser(v)}`));
writeFileSync(FILE, `{\n  "_comment": ${JSON.stringify(file._comment)},\n  "terminals": {\n${body.join(',\n')}\n  }\n}\n`);
console.log(`terminals resolved: ${[...entries.values()].reduce((n, e) => n + e.entry.lines.length, 0)} line ends in ${entries.size} entries; ${unresolved.length} left for hand curation:`);
for (const u of unresolved) console.log('  ' + u);

// Downloads the official Horários do Funchal GTFS feed and keeps the stops (official coordinates) as data/gtfs/stops.json.
// The ZIP is read in memory (no unzip tool needed). `npm run fetch:gtfs` — build:data only reads the small JSON.
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const URL_ZIP = process.env.GTFS_URL ?? 'https://www.horariosdofunchal.pt/googletransit.zip';
const OUT = process.env.GTFS_OUT ? pathToFileURL(process.env.GTFS_OUT.replace(/[\/]*$/, '/')) : new URL('../data/gtfs/', import.meta.url);

/** Minimal ZIP reader: central directory -> { name: Buffer } for the wanted entries. */
export function unzip(buf, wanted) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted.includes(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out[name] = method === 0 ? raw : inflateRawSync(raw);
  }
  return out;
}

function csv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h.replace(/^﻿/, ''), r[i] ?? ''])));
}

// DICO codes of the Madeira municipalities (the feed only labels the ones the operator serves)
const MUNI = { 3101: 'Calheta', 3102: 'Câmara de Lobos', 3103: 'Funchal', 3104: 'Machico', 3105: 'Ponta do Sol', 3106: 'Porto Moniz', 3107: 'Porto Santo', 3108: 'Ribeira Brava', 3109: 'Santa Cruz', 3110: 'Santana', 3111: 'São Vicente' };

const res = await fetch(URL_ZIP);
if (!res.ok) throw new Error(`${URL_ZIP}: HTTP ${res.status}`);
const zip = Buffer.from(await res.arrayBuffer());
const files = unzip(zip, ['stops.txt', 'feed_info.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'shapes.txt', 'calendar_dates.txt']);
const info = csv(files['feed_info.txt'].toString('utf8'))[0] ?? {};
const stops = csv(files['stops.txt'].toString('utf8'))
  .filter((s) => s.location_type === '0' || s.location_type === '')
  .map((s) => ({
    id: s.stop_id,
    code: s.stop_code,
    name: s.stop_name.replace(/\s*\([^()]*\)\s*$/, '').replace(/\s+/g, ' ').trim(),
    lat: +Number(s.stop_lat).toFixed(6),
    lon: +Number(s.stop_lon).toFixed(6),
    ...(MUNI[s.municipality] ? { muni: MUNI[s.municipality] } : {}),
  }))
  .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.lat > 32 && s.lat < 34);

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('stops.json', OUT), JSON.stringify({ source: URL_ZIP, feedVersion: info.feed_version ?? null, validFrom: info.feed_start_date ?? null, validTo: info.feed_end_date ?? null, stops }));
console.log(`GTFS ${info.feed_version ?? '?'} (${info.feed_start_date}–${info.feed_end_date}): ${stops.length} stops -> data/gtfs/stops.json`);

// Timetables of the Horários do Funchal lines (parse.mjs `applyGtfs` reads data/gtfs/lines.json) and the official route shapes (data/gtfs/shapes.json).
// Lines are listed in GTFS_LINES (default: every line of the feed; `GTFS_LINES=032,105` for some).
// Only the long-term services of the feed are kept (UE = weekday in term time, UNE = weekday in school holidays, S = Saturday, D = Sunday and holidays;
// the one-week transitional *_043 services are dropped). Compact: per line the groups of trips that share direction_id, headsign, shape and stop list;
// stops as feed stop ids (names and positions are in stops.json), every trip as the minute of its first stop and the minutes between the stops after it.
const GTFS_LINES = (process.env.GTFS_LINES ?? 'all').split(',');
const ALL_LINES = GTFS_LINES[0] === 'all';
const SERVICE_DAY = { UE: 'weekday_school', UNE: 'weekday_holiday', S: 'saturday', D: 'sunday' };
const routes = new Map(csv(files['routes.txt'].toString('utf8')).filter((r) => ALL_LINES || GTFS_LINES.includes(r.line_id)).map((r) => [r.route_id, r]));
const trips = new Map();
for (const t of csv(files['trips.txt'].toString('utf8'))) {
  const day = SERVICE_DAY[t.service_id.split('_')[0]];
  if (!routes.has(t.route_id) || !day || !t.service_id.endsWith('_044')) continue;
  trips.set(t.trip_id, { line: routes.get(t.route_id).line_id, dir: t.direction_id || '0', day, head: t.trip_headsign, shape: t.shape_id, rows: [] });
}
for (const r of csv(files['stop_times.txt'].toString('utf8'))) {
  const t = trips.get(r.trip_id);
  if (!t) continue;
  const [h, m, sec] = (r.departure_time || r.arrival_time).split(':').map(Number);
  t.rows.push({ seq: Number(r.stop_sequence), stop: r.stop_id, min: Math.round((h * 3600 + m * 60 + (sec || 0)) / 60) });
}
const byLine = {};
const usedShapes = new Set();
for (const t of trips.values()) {
  t.rows.sort((a, b) => a.seq - b.seq);
  const ids = t.rows.map((x) => x.stop);
  const groups = (byLine[t.line] ??= new Map());
  const key = [t.dir, t.head, t.shape, ids.join(',')].join('|');
  const g = groups.get(key) ?? { dir: t.dir, head: t.head, shape: t.shape || null, ids, trips: new Map() };
  groups.set(key, g);
  const enc = t.rows.map((x, i) => (i ? x.min - t.rows[i - 1].min : x.min)).join(' ');
  (g.trips.get(enc) ?? g.trips.set(enc, []).get(enc)).push(t.day);
  if (t.shape) usedShapes.add(t.shape);
}
const linesOut = Object.fromEntries(Object.entries(byLine).map(([l, groups]) => [l, [...groups.values()].map((g) => ({ dir: g.dir, head: g.head, shape: g.shape, ids: g.ids, trips: [...g.trips.entries()] }))]));
writeFileSync(new URL('lines.json', OUT), JSON.stringify({ source: URL_ZIP, feedVersion: info.feed_version ?? null, lines: linesOut }));
console.log(`GTFS timetables: ${Object.entries(byLine).map(([l, m]) => `${l}:${[...m.values()].reduce((n, g) => n + [...g.trips.values()].reduce((a, d) => a + d.length, 0), 0)}`).join(' ')} -> data/gtfs/lines.json`);

// Official route shapes of the used trips, thinned with Douglas-Peucker (2 m) and rounded to 5 decimals like data/shapes
const pts = new Map();
for (const r of csv(files['shapes.txt'].toString('utf8'))) if (usedShapes.has(r.shape_id)) (pts.get(r.shape_id) ?? pts.set(r.shape_id, []).get(r.shape_id)).push([Number(r.shape_pt_sequence), +Number(r.shape_pt_lat).toFixed(5), +Number(r.shape_pt_lon).toFixed(5)]);
const M_LAT = 110540;
const M_LON = 111320 * Math.cos((32.7 * Math.PI) / 180);
function simplify(p, eps) {
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1;
    let max = eps;
    const [ay, ax] = [p[a][0] * M_LAT, p[a][1] * M_LON];
    const [by, bx] = [p[b][0] * M_LAT, p[b][1] * M_LON];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    for (let i = a + 1; i < b; i++) {
      const [py, px] = [p[i][0] * M_LAT, p[i][1] * M_LON];
      const u = len2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2)) : 0;
      const d = Math.hypot(px - (ax + u * (bx - ax)), py - (ay + u * (by - ay)));
      if (d > max) { max = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return p.filter((_, i) => keep[i]);
}
const shapesOut = {};
for (const [id, list] of pts) shapesOut[id] = simplify(list.sort((a, b) => a[0] - b[0]).map(([, la, lo]) => [la, lo]), 2);
writeFileSync(new URL('shapes.json', OUT), JSON.stringify(shapesOut));
console.log(`GTFS shapes: ${Object.keys(shapesOut).length}, ${Object.values(shapesOut).reduce((n, p) => n + p.length, 0)} points -> data/gtfs/shapes.json`);

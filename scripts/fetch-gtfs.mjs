// Downloads the official Horários do Funchal GTFS feed and keeps the stops (official coordinates) as data/gtfs/stops.json.
// The ZIP is read in memory (no unzip tool needed). `npm run fetch:gtfs` — build:data only reads the small JSON.
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const URL_ZIP = process.env.GTFS_URL ?? 'https://www.horariosdofunchal.pt/googletransit.zip';
const OUT = new URL('../data/gtfs/', import.meta.url);

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
const files = unzip(zip, ['stops.txt', 'feed_info.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar_dates.txt']);
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

// Timetables of the lines whose PDF cannot be parsed (parse.mjs `applyGtfs` reads data/gtfs/lines.json). Lines are listed in GTFS_LINES.
// Only the long-term services of the feed are kept (UE = weekday in term time, UNE = weekday in school holidays, S = Saturday, D = Sunday and holidays;
// the one-week transitional *_043 services are dropped). Compact: per line and direction_id the stop list and the trips as time strings.
const GTFS_LINES = (process.env.GTFS_LINES ?? '032,060,061,062,090,094,105').split(',');
const SERVICE_DAY = { UE: 'weekday_school', UNE: 'weekday_holiday', S: 'saturday', D: 'sunday' };
const hhmm = (t) => {
  const [h, m, s] = t.split(':').map(Number);
  const total = Math.round((h * 3600 + m * 60 + (s || 0)) / 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const stopName = new Map(csv(files['stops.txt'].toString('utf8')).map((s) => [s.stop_id, s.stop_name.replace(/\s*\([^()]*\)\s*$/, '').replace(/\s+/g, ' ').trim()]));
const routes = new Map(csv(files['routes.txt'].toString('utf8')).filter((r) => GTFS_LINES.includes(r.line_id)).map((r) => [r.route_id, r]));
const trips = new Map();
for (const t of csv(files['trips.txt'].toString('utf8'))) {
  const day = SERVICE_DAY[t.service_id.split('_')[0]];
  if (!routes.has(t.route_id) || !day || !t.service_id.endsWith('_044')) continue;
  trips.set(t.trip_id, { line: routes.get(t.route_id).line_id, dir: t.direction_id || '0', day, head: t.trip_headsign, times: [] });
}
for (const r of csv(files['stop_times.txt'].toString('utf8'))) {
  const t = trips.get(r.trip_id);
  if (t) t.times.push({ seq: Number(r.stop_sequence), stop: r.stop_id, t: hhmm(r.departure_time || r.arrival_time) });
}
const byLine = {};
for (const t of trips.values()) {
  t.times.sort((a, b) => a.seq - b.seq);
  (byLine[t.line] ??= []).push({ dir: t.dir, day: t.day, head: t.head, stops: t.times.map((x) => stopName.get(x.stop) ?? x.stop), ids: t.times.map((x) => x.stop), times: t.times.map((x) => x.t) });
}
writeFileSync(new URL('lines.json', OUT), JSON.stringify({ source: URL_ZIP, feedVersion: info.feed_version ?? null, lines: byLine }));
console.log(`GTFS timetables: ${[...trips.size ? Object.entries(byLine) : []].map(([l, a]) => `${l}:${a.length}`).join(' ')} -> data/gtfs/lines.json`);

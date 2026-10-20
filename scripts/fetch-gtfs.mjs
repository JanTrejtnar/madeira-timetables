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
const files = unzip(zip, ['stops.txt', 'feed_info.txt']);
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

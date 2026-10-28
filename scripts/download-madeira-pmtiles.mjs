// Cuts the offline-map archive public/maps/madeira.pmtiles (Madeira + Porto Santo) out of the public Protomaps planet build with HTTP Range
// requests: the same job as `pmtiles extract`, in plain Node (no binary). Only the directories and the tiles inside the bounding box are fetched
// (tens of MB of a ~100 GB file); the tiles are copied byte for byte, so the Protomaps basemap schema of the build is kept.
// Usage: node scripts/download-madeira-pmtiles.mjs [--bbox w,s,e,n] [--maxzoom N] [--out FILE] [--date YYYYMMDD | --source URL]
// Without --date / --source the newest daily build of https://build.protomaps.com is used. Attribution: © OpenStreetMap contributors, Protomaps.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import { zxyToTileId } from 'pmtiles';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const [W, S, E, N] = opt('bbox', '-17.30,32.60,-16.25,33.15').split(',').map(Number);
if ([W, S, E, N].some((v) => !Number.isFinite(v)) || W >= E || S >= N) throw new Error('--bbox must be west,south,east,north in degrees');
const OUT = path.resolve(opt('out', 'public/maps/madeira.pmtiles'));
const MAX_ZOOM = Number(opt('maxzoom', 99));
const HEADER_BYTES = 127;
const ROOT_MAX = 16384 - HEADER_BYTES; // the root directory must fit in the first 16 kB with the header
const MAX_GAP = 128 * 1024; // tiles closer than this are fetched in one request (over-fetching the gap)
const MAX_REQUEST = 8 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- ranged reads ---------------------------------------------------------------------------------------------------------------------
let requests = 0;
let fetched = 0;
async function range(url, start, length) {
  for (let attempt = 1; ; attempt++) {
    try {
      requests++;
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
      if (res.status !== 206) {
        await res.body?.cancel(); // a 200 would be the whole planet file: never read it
        const err = new Error(`HTTP ${res.status} for ${url} (a ranged read must answer 206)`);
        err.fatal = res.status < 500;
        throw err;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < length) throw new Error(`short read at ${start}: ${buf.length} of ${length} bytes`);
      fetched += buf.length;
      return buf;
    } catch (e) {
      if (e.fatal || attempt >= 4) throw e;
      await sleep(500 * 2 ** attempt);
    }
  }
}
async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}

// ---- PMTiles v3 pieces ----------------------------------------------------------------------------------------------------------------
function parseHeader(b) {
  if (b.toString('latin1', 0, 7) !== 'PMTiles' || b[7] !== 3) throw new Error('not a PMTiles v3 archive');
  const u64 = (at) => Number(b.readBigUInt64LE(at));
  return {
    rootOffset: u64(8), rootLength: u64(16), metaOffset: u64(24), metaLength: u64(32), leafOffset: u64(40), leafLength: u64(48), dataOffset: u64(56),
    clustered: b[96], internalCompression: b[97], tileCompression: b[98], tileType: b[99], minZoom: b[100], maxZoom: b[101],
  };
}
function decompress(buf, code) {
  if (code === 1) return buf;
  if (code === 2) return gunzipSync(buf);
  if (code === 3) return brotliDecompressSync(buf);
  throw new Error(`unsupported internal compression ${code}`);
}
function readVarints(buf) {
  let p = 0;
  return () => {
    let v = 0;
    let mul = 1;
    let b;
    do {
      b = buf[p++];
      v += (b & 127) * mul;
      mul *= 128;
    } while (b & 128);
    return v;
  };
}
function parseDirectory(buf) {
  const next = readVarints(buf);
  const n = next();
  const e = Array.from({ length: n }, () => ({ tileId: 0, run: 0, length: 0, offset: 0 }));
  let id = 0;
  for (const x of e) x.tileId = id += next();
  for (const x of e) x.run = next();
  for (const x of e) x.length = next();
  e.forEach((x, i) => {
    const v = next();
    x.offset = v === 0 && i > 0 ? e[i - 1].offset + e[i - 1].length : v - 1;
  });
  return e;
}
function varint(n) {
  const out = [];
  while (n >= 128) {
    out.push((n % 128) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}
function serializeDirectory(list) {
  const parts = [varint(list.length)];
  let prev = 0;
  for (const e of list) {
    parts.push(varint(e.tileId - prev));
    prev = e.tileId;
  }
  for (const e of list) parts.push(varint(e.run));
  for (const e of list) parts.push(varint(e.length));
  list.forEach((e, i) => parts.push(varint(i > 0 && e.offset === list[i - 1].offset + list[i - 1].length ? 0 : e.offset + 1)));
  return Buffer.concat(parts);
}
/** the root directory, plus leaf directories when the entries do not fit in the first 16 kB */
function buildDirectories(entries) {
  const single = gzipSync(serializeDirectory(entries));
  if (single.length <= ROOT_MAX) return { root: single, leaves: Buffer.alloc(0) };
  for (let size = 4096; ; size *= 2) {
    const leaves = [];
    const rootEntries = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += size) {
      const chunk = entries.slice(i, i + size);
      const blob = gzipSync(serializeDirectory(chunk));
      rootEntries.push({ tileId: chunk[0].tileId, run: 0, length: blob.length, offset });
      leaves.push(blob);
      offset += blob.length;
    }
    const root = gzipSync(serializeDirectory(rootEntries));
    if (root.length <= ROOT_MAX) return { root, leaves: Buffer.concat(leaves) };
  }
}

// ---- which source ---------------------------------------------------------------------------------------------------------------------
async function findSource() {
  const given = opt('source');
  if (given) return given;
  const dates = [];
  if (opt('date')) dates.push(opt('date'));
  else for (let d = 0; d < 21; d++) dates.push(new Date(Date.now() - d * 864e5).toISOString().slice(0, 10).replaceAll('-', ''));
  for (const date of dates) {
    const url = `https://build.protomaps.com/${date}.pmtiles`;
    try {
      const head = await range(url, 0, HEADER_BYTES);
      parseHeader(head);
      return url;
    } catch (e) {
      console.log(`  ${date}: not available (${e.message.slice(0, 60)})`);
    }
  }
  throw new Error('no Protomaps build found; pass --source URL or --date YYYYMMDD');
}

// ---- main -----------------------------------------------------------------------------------------------------------------------------
const url = await findSource();
console.log('source:', url);
const first = await range(url, 0, 16384);
const h = parseHeader(first);
if (h.tileType !== 1) throw new Error(`tile type ${h.tileType} is not MVT`);
const maxZ = Math.min(h.maxZoom, MAX_ZOOM);
console.log(`bbox ${W},${S},${E},${N}  zoom 0-${maxZ}`);

// the tile ids (Hilbert curve) of the bbox on every zoom
const worldX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const worldY = (lat, z) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
const needed = [];
for (let z = 0; z <= maxZ; z++) {
  const top = 2 ** z - 1;
  const clamp = (v) => Math.max(0, Math.min(top, Math.floor(v)));
  for (let x = clamp(worldX(W, z)); x <= clamp(worldX(E, z)); x++) for (let y = clamp(worldY(N, z)); y <= clamp(worldY(S, z)); y++) needed.push(zxyToTileId(z, x, y));
}
needed.sort((a, b) => a - b);
const lower = (v) => {
  let lo = 0;
  let hi = needed.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (needed[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
console.log(`${needed.length} tiles in the bbox`);

// walk the directory tree, entering only the leaf directories that can hold a wanted tile
const found = [];
async function walk(entries) {
  const leaves = [];
  entries.forEach((e, i) => {
    if (e.run > 0) {
      for (let k = lower(e.tileId); k < needed.length && needed[k] < e.tileId + e.run; k++) found.push({ id: needed[k], offset: e.offset, length: e.length });
    } else {
      const end = i + 1 < entries.length ? entries[i + 1].tileId : Infinity;
      const k = lower(e.tileId);
      if (k < needed.length && needed[k] < end) leaves.push(e);
    }
  });
  await pool(leaves, 6, async (leaf) => walk(parseDirectory(decompress(await range(url, h.leafOffset + leaf.offset, leaf.length), h.internalCompression))));
}
await walk(parseDirectory(decompress(first.subarray(h.rootOffset, h.rootOffset + h.rootLength), h.internalCompression)));
found.sort((a, b) => a.id - b.id);
console.log(`${found.length} of them exist in the build (${requests} requests so far)`);
if (!found.length) throw new Error('no tile in the bbox: wrong coordinates?');

// the tile bytes: distinct blobs in source order, neighbours merged into few requests
const blobs = new Map(); // source offset -> { length, data }
for (const t of found) blobs.set(t.offset, { length: t.length, data: null });
const sorted = [...blobs.entries()].sort((a, b) => a[0] - b[0]);
const groups = [];
for (const [offset, b] of sorted) {
  const g = groups.at(-1);
  if (g && offset - g.end <= MAX_GAP && offset + b.length - g.start <= MAX_REQUEST) {
    g.end = offset + b.length;
    g.items.push(offset);
  } else groups.push({ start: offset, end: offset + b.length, items: [offset] });
}
let done = 0;
await pool(groups, 6, async (g) => {
  const buf = await range(url, h.dataOffset + g.start, g.end - g.start); // tile offsets are relative to the tile data section
  for (const off of g.items) blobs.get(off).data = buf.subarray(off - g.start, off - g.start + blobs.get(off).length);
  if (++done % 10 === 0 || done === groups.length) process.stdout.write(`\r  tile data: ${done}/${groups.length} requests, ${(fetched / 1048576).toFixed(1)} MB fetched`);
});
process.stdout.write('\n');

// the new archive: tiles in id order, identical blobs stored once
const dataParts = [];
const placed = new Map();
const entries = [];
let pos = 0;
for (const t of found) {
  let off = placed.get(t.offset);
  if (off === undefined) {
    off = pos;
    placed.set(t.offset, off);
    const blob = blobs.get(t.offset).data;
    dataParts.push(blob);
    pos += blob.length;
  }
  const last = entries.at(-1);
  if (last && last.offset === off && last.tileId + last.run === t.id) last.run++;
  else entries.push({ tileId: t.id, run: 1, length: t.length, offset: off });
}
const tileData = Buffer.concat(dataParts);
const { root, leaves } = buildDirectories(entries);
const meta = gzipSync(decompress(await range(url, h.metaOffset, h.metaLength), h.internalCompression));

const header = Buffer.alloc(HEADER_BYTES);
header.write('PMTiles', 0, 'latin1');
header[7] = 3;
const put = (v, at) => header.writeBigUInt64LE(BigInt(v), at);
put(HEADER_BYTES, 8);
put(root.length, 16);
put(HEADER_BYTES + root.length, 24);
put(meta.length, 32);
put(HEADER_BYTES + root.length + meta.length, 40);
put(leaves.length, 48);
put(HEADER_BYTES + root.length + meta.length + leaves.length, 56);
put(tileData.length, 64);
put(found.length, 72);
put(entries.length, 80);
put(placed.size, 88);
header[96] = 1; // clustered
header[97] = 2; // directories and metadata: gzip
header[98] = h.tileCompression; // tiles are copied as they are
header[99] = 1; // MVT
header[100] = h.minZoom;
header[101] = maxZ;
const e7 = (v) => Math.round(v * 1e7);
header.writeInt32LE(e7(W), 102);
header.writeInt32LE(e7(S), 106);
header.writeInt32LE(e7(E), 110);
header.writeInt32LE(e7(N), 114);
header[118] = Math.min(10, maxZ);
header.writeInt32LE(e7((W + E) / 2), 119);
header.writeInt32LE(e7((S + N) / 2), 123);

mkdirSync(path.dirname(OUT), { recursive: true });
const file = Buffer.concat([header, root, meta, leaves, tileData]);
writeFileSync(OUT + '.tmp', file);
renameSync(OUT + '.tmp', OUT);
console.log(`${OUT}\n  ${found.length} tiles (${placed.size} distinct), ${entries.length} directory entries, ${leaves.length ? 'with leaf directories' : 'root directory only'}, ${(file.length / 1048576).toFixed(2)} MB`);
console.log(`  fetched ${(fetched / 1048576).toFixed(1)} MB in ${requests} requests. Attribution: © OpenStreetMap contributors, Protomaps`);

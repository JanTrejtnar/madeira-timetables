// Writes a SMALL TEST archive tests/fixtures/madeira-test.pmtiles (PMTiles v3, vector tiles in the Protomaps schema) from this project's own data:
// the bus routes as roads, the towns of pois.json as place labels, one land polygon over Madeira. It exists so the offline-map code
// (download into Cache Storage, reading, drawing) can be developed and tested without the real Protomaps extract; it is NOT a map.
// The committed fixture is what the tests and the e2e suite use; the REAL archive goes to public/maps/madeira.pmtiles (see CLAUDE.md,
// "Offline maps"). Usage: node scripts/make-test-pmtiles.mjs [--force]   (needs the built public/data/shapes: npm run build:data)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zxyToTileId } from 'pmtiles';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'fixtures', 'madeira-test.pmtiles');
if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.log('exists, left alone:', OUT);
  process.exit(0);
}
const MIN_Z = 6;
const MAX_Z = 14;
const EXTENT = 4096;
const BOX = { w: -17.3, s: 32.58, e: -16.6, n: 32.9 };

// ---- data ----------------------------------------------------------------------------------------------------------------------------
const shapesDir = path.join(ROOT, 'public', 'data', 'shapes');
const lines = readdirSync(shapesDir).map((f) => JSON.parse(readFileSync(path.join(shapesDir, f), 'utf8')).filter((p) => p[0] < 32.95));
const places = JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', 'pois.json'), 'utf8')).places.filter((p) => (p[1] === 'town' || p[1] === 'village') && p[2] < 32.95).slice(0, 120);

// ---- projection ----------------------------------------------------------------------------------------------------------------------
const worldX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const worldY = (lat, z) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;

// ---- protobuf / MVT --------------------------------------------------------------------------------------------------------------------
const varint = (n) => {
  const out = [];
  let v = BigInt(n);
  while (v > 127n) {
    out.push(Number(v & 127n) | 128);
    v >>= 7n;
  }
  out.push(Number(v));
  return Buffer.from(out);
};
const zigzag = (n) => (n << 1) ^ (n >> 31);
const field = (num, wire, payload) => Buffer.concat([varint((num << 3) | wire), payload]);
const lenField = (num, buf) => field(num, 2, Buffer.concat([varint(buf.length), buf]));
const packed = (nums) => Buffer.concat(nums.map((n) => varint(n)));

/** geometry command stream of rings / lines given as arrays of [x, y] integer tile coordinates */
function geometry(parts, closed) {
  const cmds = [];
  let cx = 0;
  let cy = 0;
  for (const pts of parts) {
    cmds.push((1 << 3) | 1, zigzag(pts[0][0] - cx), zigzag(pts[0][1] - cy));
    [cx, cy] = pts[0];
    cmds.push(((pts.length - 1) << 3) | 2);
    for (const [x, y] of pts.slice(1)) {
      cmds.push(zigzag(x - cx), zigzag(y - cy));
      [cx, cy] = [x, y];
    }
    if (closed) cmds.push((1 << 3) | 7);
  }
  return cmds;
}

/** a layer from features { type: 1|2|3, parts, props } */
function layer(name, features) {
  const keys = [];
  const values = [];
  const keyIx = (k) => (keys.includes(k) ? keys.indexOf(k) : keys.push(k) - 1);
  const valIx = (v) => {
    const i = values.findIndex((x) => x === v);
    return i >= 0 ? i : values.push(v) - 1;
  };
  const feats = features.map((f) => {
    const tags = [];
    for (const [k, v] of Object.entries(f.props)) tags.push(keyIx(k), valIx(v));
    return Buffer.concat([
      field(3, 0, varint(f.type)),
      lenField(2, packed(tags)),
      lenField(4, packed(geometry(f.parts, f.type === 3))),
    ]);
  });
  return Buffer.concat([
    field(15, 0, varint(2)),
    lenField(1, Buffer.from(name)),
    ...feats.map((b) => lenField(2, b)),
    ...keys.map((k) => lenField(3, Buffer.from(k))),
    ...values.map((v) => lenField(4, typeof v === 'number' ? field(5, 0, varint(v)) : lenField(1, Buffer.from(String(v))))),
    field(5, 0, varint(EXTENT)),
  ]);
}

// ---- tiles ---------------------------------------------------------------------------------------------------------------------------
const tiles = []; // { id, data }
for (let z = MIN_Z; z <= MAX_Z; z++) {
  const n = 2 ** z;
  const tol = 1.2 / 256 / n; // in tile-fraction units: ~1 px of a 256 tile
  const x0 = Math.floor(worldX(BOX.w, z));
  const x1 = Math.floor(worldX(BOX.e, z));
  const y0 = Math.floor(worldY(BOX.n, z));
  const y1 = Math.floor(worldY(BOX.s, z));
  const runs = new Map(); // "x/y" -> array of polylines in tile coordinates
  const pushRun = (tx, ty, pts) => {
    const k = `${tx}/${ty}`;
    (runs.get(k) ?? runs.set(k, []).get(k)).push(pts);
  };
  for (const line of lines) {
    // thin the polyline, in world-fraction coordinates
    const pts = [];
    let last = null;
    for (const [lat, lon] of line) {
      const p = [worldX(lon, z), worldY(lat, z)];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= tol * 256) {
        pts.push(p);
        last = p;
      }
    }
    // each segment goes to the tiles its bounding box touches; consecutive segments of one tile make one run
    const open = new Map();
    const close = (k) => {
      const run = open.get(k);
      if (run && run.length > 1) {
        const [tx, ty] = k.split('/').map(Number);
        pushRun(tx, ty, run.map(([x, y]) => [Math.round((x - tx) * EXTENT), Math.round((y - ty) * EXTENT)]));
      }
      open.delete(k);
    };
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const touched = new Set();
      for (let tx = Math.floor(Math.min(ax, bx)); tx <= Math.floor(Math.max(ax, bx)); tx++) for (let ty = Math.floor(Math.min(ay, by)); ty <= Math.floor(Math.max(ay, by)); ty++) touched.add(`${tx}/${ty}`);
      for (const k of [...open.keys()]) if (!touched.has(k)) close(k);
      for (const k of touched) {
        const run = open.get(k);
        if (run) run.push(pts[i]);
        else open.set(k, [pts[i - 1], pts[i]]);
      }
    }
    for (const k of [...open.keys()]) close(k);
  }
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      const clampPx = (v) => Math.max(-64, Math.min(EXTENT + 64, Math.round(v)));
      // land: the part of the box inside this tile
      const lx0 = clampPx((worldX(BOX.w, z) - tx) * EXTENT);
      const lx1 = clampPx((worldX(BOX.e, z) - tx) * EXTENT);
      const ly0 = clampPx((worldY(BOX.n, z) - ty) * EXTENT);
      const ly1 = clampPx((worldY(BOX.s, z) - ty) * EXTENT);
      const layers = [layer('earth', [{ type: 3, parts: [[[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1]]], props: {} }])];
      const road = runs.get(`${tx}/${ty}`);
      if (road) layers.push(layer('roads', [{ type: 2, parts: road, props: { kind: 'major_road', kind_detail: 'primary', min_zoom: 6 } }]));
      if (z >= 9) {
        const here = places.filter((p) => Math.floor(worldX(p[3], z)) === tx && Math.floor(worldY(p[2], z)) === ty);
        if (here.length)
          layers.push(
            layer(
              'places',
              here.map((p) => ({ type: 1, parts: [[[Math.round((worldX(p[3], z) - tx) * EXTENT), Math.round((worldY(p[2], z) - ty) * EXTENT)]]], props: { kind: 'locality', kind_detail: p[1] === 'town' ? 'town' : 'village', name: p[0], min_zoom: p[1] === 'town' ? 9 : 11, population_rank: p[1] === 'town' ? 8 : 5 } })),
            ),
          );
      }
      tiles.push({ id: zxyToTileId(z, tx, ty), data: gzipSync(Buffer.concat(layers.map((l) => lenField(3, l)))) });
    }
  }
}
tiles.sort((a, b) => a.id - b.id);

// ---- PMTiles v3 archive --------------------------------------------------------------------------------------------------------------------
const tileData = Buffer.concat(tiles.map((t) => t.data));
let offset = 0;
const entries = tiles.map((t) => {
  const e = { id: t.id, offset, length: t.data.length };
  offset += t.data.length;
  return e;
});
const dir = (list) => {
  const parts = [varint(list.length)];
  let prev = 0;
  for (const e of list) {
    parts.push(varint(e.id - prev));
    prev = e.id;
  }
  for (let i = 0; i < list.length; i++) parts.push(varint(1)); // run length
  for (const e of list) parts.push(varint(e.length));
  for (let i = 0; i < list.length; i++) parts.push(varint(i > 0 && list[i].offset === list[i - 1].offset + list[i - 1].length ? 0 : list[i].offset + 1));
  return gzipSync(Buffer.concat(parts));
};
const root = dir(entries);
const meta = gzipSync(Buffer.from(JSON.stringify({ name: 'madeira test archive', description: 'TEST DATA built from the project routes (scripts/make-test-pmtiles.mjs), not a map', attribution: 'test' })));
const HEADER = 127;
const header = Buffer.alloc(HEADER);
header.write('PMTiles', 0, 'latin1');
header[7] = 3;
const u64 = (v, at) => header.writeBigUInt64LE(BigInt(v), at);
u64(HEADER, 8); // root directory
u64(root.length, 16);
u64(HEADER + root.length, 24); // metadata
u64(meta.length, 32);
u64(0, 40); // no leaf directories
u64(0, 48);
u64(HEADER + root.length + meta.length, 56); // tile data
u64(tileData.length, 64);
u64(tiles.length, 72);
u64(tiles.length, 80);
u64(tiles.length, 88);
header[96] = 1; // clustered
header[97] = 2; // internal compression: gzip
header[98] = 2; // tile compression: gzip
header[99] = 1; // tile type: MVT
header[100] = MIN_Z;
header[101] = MAX_Z;
const e7 = (v) => Math.round(v * 1e7);
header.writeInt32LE(e7(BOX.w), 102);
header.writeInt32LE(e7(BOX.s), 106);
header.writeInt32LE(e7(BOX.e), 110);
header.writeInt32LE(e7(BOX.n), 114);
header[118] = 10;
header.writeInt32LE(e7((BOX.w + BOX.e) / 2), 119);
header.writeInt32LE(e7((BOX.s + BOX.n) / 2), 123);

mkdirSync(path.dirname(OUT), { recursive: true });
const file = Buffer.concat([header, root, meta, tileData]);
writeFileSync(OUT, file);
console.log(`test archive: ${tiles.length} tiles, z${MIN_Z}-${MAX_Z}, ${(file.length / 1024).toFixed(0)} kB -> ${OUT}`);

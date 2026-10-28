import { existsSync, readFileSync, statSync } from 'node:fs';
import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { PMTiles } from 'pmtiles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shapeFileUrl } from '../src/lib/shapeUrl';
import { CacheArchiveSource, downloadArchive as download, fmtBytes, offlineMapInstalled, probeArchive, probePack, readInstalled, removeArchive, type DownloadOptions, type Progress } from '../src/lib/offlineMaps';

/** the archive alone (the route pack has its own tests below) */
const downloadArchive = (o: DownloadOptions = {}) => download({ shapes: null, ...o });

// ---- an in-memory Cache Storage entry and a fetch that serves byte ranges ------------------------------------------------------------------
function memoryCache(): Cache {
  const store = new Map<string, { body: ArrayBuffer; headers: [string, string][] }>();
  const urlOf = (r: RequestInfo | URL) => (typeof r === 'string' ? r : r instanceof URL ? r.href : r.url);
  return {
    async match(r: RequestInfo | URL) {
      const e = store.get(urlOf(r));
      return e ? new Response(e.body.slice(0), { headers: e.headers }) : undefined;
    },
    async put(r: RequestInfo | URL, res: Response) {
      store.set(urlOf(r), { body: await res.arrayBuffer(), headers: [...res.headers.entries()] });
    },
    async delete(r: RequestInfo | URL) {
      return store.delete(urlOf(r));
    },
    async keys() {
      return [...store.keys()].map((u) => new Request(new URL(u, 'http://localhost')));
    },
  } as unknown as Cache;
}

function archiveBytes(size: number): Uint8Array {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (i * 31 + 7) & 255;
  b.set(new TextEncoder().encode('PMTiles'), 0);
  return b;
}

/** a server for one file; `ranges: false` answers every request with the whole file (200) */
function server(file: Uint8Array, opts: { ranges?: boolean; etag?: string; failAt?: number } = {}) {
  const { ranges = true, etag = '"v1"' } = opts;
  const calls: string[] = [];
  const fn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    calls.push(range ?? 'full');
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (opts.failAt !== undefined && calls.length > opts.failAt) throw new TypeError('Failed to fetch');
    if (ranges && range) {
      const m = /bytes=(\d+)-(\d+)/.exec(range)!;
      const start = Number(m[1]);
      const end = Math.min(file.length - 1, Number(m[2]));
      return new Response(file.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${file.length}`, etag } });
    }
    return new Response(file.slice(), { status: 200, headers: { 'content-length': String(file.length), etag } });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

beforeEach(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
});

describe('probeArchive', () => {
  it('reads the size from Content-Range and the version from the ETag', async () => {
    const s = server(archiveBytes(5000));
    expect(await probeArchive('/x.pmtiles', s.fn)).toEqual({ size: 5000, version: 'v1', ranges: true });
  });
  it('notices a server without byte ranges', async () => {
    const s = server(archiveBytes(5000), { ranges: false });
    expect(await probeArchive('/x.pmtiles', s.fn)).toMatchObject({ size: 5000, ranges: false });
  });
  it('rejects what is not a PMTiles file (a single-page host answers unknown paths with its HTML)', async () => {
    const html = new TextEncoder().encode('<!doctype html><title>app</title>'.padEnd(300, ' '));
    await expect(probeArchive('/x', server(html, { ranges: false }).fn)).rejects.toThrow(/not a PMTiles/);
    await expect(probeArchive('/x', (async () => new Response('nope', { status: 404 })) as typeof fetch)).rejects.toThrow(/404/);
  });
});

describe('downloadArchive', () => {
  it('stores the archive in chunks, reports progress, and installs it only at the end', async () => {
    const file = archiveBytes(10_000);
    const cache = memoryCache();
    const progress: Progress[] = [];
    const s = server(file);
    const pack = await downloadArchive({ url: '/x', cache, fetchFn: s.fn, chunkBytes: 4096, onProgress: (p) => progress.push(p) });
    expect(pack).toMatchObject({ size: 10_000, chunks: 3, chunkBytes: 4096, version: 'v1' });
    expect(progress.at(-1)).toEqual({ done: 10_000, total: 10_000 });
    expect(progress.map((p) => p.done)).toEqual([...progress.map((p) => p.done)].sort((a, b) => a - b));
    expect(await readInstalled(cache)).toMatchObject({ chunks: 3 });
    expect(offlineMapInstalled()).toBe(true);
    // the bytes read back through the source are the bytes of the file, across chunk borders
    const source = new CacheArchiveSource(cache, pack);
    for (const [off, len] of [[0, 127], [4090, 20], [4096, 4096], [9990, 500], [0, 10_000]] as const) {
      const got = new Uint8Array((await source.getBytes(off, len)).data);
      expect(got).toEqual(file.slice(off, Math.min(10_000, off + len)));
    }
  });

  it('continues an interrupted download with the chunks already stored', async () => {
    const file = archiveBytes(10_000);
    const cache = memoryCache();
    const broken = server(file, { failAt: 3 }); // probe + 2 chunks, then the network goes
    await expect(downloadArchive({ url: '/x', cache, fetchFn: broken.fn, chunkBytes: 2048 })).rejects.toThrow();
    expect(await readInstalled(cache)).toBeNull();
    expect(offlineMapInstalled()).toBe(false);
    const again = server(file);
    const pack = await downloadArchive({ url: '/x', cache, fetchFn: again.fn, chunkBytes: 2048 });
    // probe + the 3 missing chunks (5 in all, 2 were there)
    expect(again.calls.filter((c) => c !== 'bytes=0-6')).toHaveLength(3);
    expect(pack.chunks).toBe(5);
    const all = new Uint8Array((await new CacheArchiveSource(cache, pack).getBytes(0, 10_000)).data);
    expect(all).toEqual(file);
  });

  it('a cancelled download keeps its chunks and is not installed', async () => {
    const ctl = new AbortController();
    const cache = memoryCache();
    const s = server(archiveBytes(8000));
    await expect(downloadArchive({ url: '/x', cache, fetchFn: s.fn, chunkBytes: 2000, signal: ctl.signal, onProgress: (p) => p.done >= 4000 && ctl.abort() })).rejects.toThrow();
    expect(await readInstalled(cache)).toBeNull();
    expect((await cache.keys()).some((k) => k.url.endsWith('chunk-0'))).toBe(true);
  });

  it('a server without byte ranges is read once and cut into chunks', async () => {
    const file = archiveBytes(7000);
    const cache = memoryCache();
    const s = server(file, { ranges: false });
    const pack = await downloadArchive({ url: '/x', cache, fetchFn: s.fn, chunkBytes: 3000 });
    expect(s.calls).toEqual(['bytes=0-6', 'full']);
    expect(new Uint8Array((await new CacheArchiveSource(cache, pack).getBytes(0, 7000)).data)).toEqual(file);
  });

  it('an unchanged archive is not downloaded again; a new version replaces the old pack', async () => {
    const cache = memoryCache();
    const v1 = server(archiveBytes(6000), { etag: '"v1"' });
    await downloadArchive({ url: '/x', cache, fetchFn: v1.fn, chunkBytes: 2000 });
    const same = server(archiveBytes(6000), { etag: '"v1"' });
    await downloadArchive({ url: '/x', cache, fetchFn: same.fn, chunkBytes: 2000 });
    expect(same.calls).toEqual(['bytes=0-6']);
    const file2 = archiveBytes(7000).map((b) => b ^ 1);
    file2.set(new TextEncoder().encode('PMTiles'), 0);
    const pack = await downloadArchive({ url: '/x', cache, fetchFn: server(file2, { etag: '"v2"' }).fn, chunkBytes: 2000 });
    expect(pack).toMatchObject({ version: 'v2', size: 7000 });
    expect(new Uint8Array((await new CacheArchiveSource(cache, pack).getBytes(0, 7000)).data)).toEqual(file2);
  });

  it('a short chunk (the connection dropped mid-body) is an error, not a corrupt pack', async () => {
    const file = archiveBytes(6000);
    const cache = memoryCache();
    const fn = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string>).Range;
      if (range === 'bytes=0-6') return new Response(file.slice(0, 7), { status: 206, headers: { 'content-range': 'bytes 0-6/6000' } });
      return new Response(file.slice(0, 100), { status: 206 });
    });
    await expect(downloadArchive({ url: '/x', cache, fetchFn: fn as unknown as typeof fetch, chunkBytes: 2000 })).rejects.toThrow(/short chunk/);
    expect(await readInstalled(cache)).toBeNull();
  });

  it('removeArchive deletes the pack and the flag', async () => {
    const cache = memoryCache();
    await downloadArchive({ url: '/x', cache, fetchFn: server(archiveBytes(5000)).fn, chunkBytes: 2000 });
    await removeArchive(cache);
    expect(await readInstalled(cache)).toBeNull();
    expect(offlineMapInstalled()).toBe(false);
    expect(await cache.keys()).toHaveLength(0);
  });
});

// ---- the route pack: all route geometries in one file, unpacked into the route cache ----------------------------------------------------------
type Pack = Record<string, [string, [number, number][]]>;
const PACK: Pack = {
  '101': ['aaaa1111', [[32.6, -16.9], [32.61, -16.91], [32.62, -16.92]]],
  '102': ['bbbb2222', [[32.7, -16.8], [32.71, -16.81]]],
  '103': ['cccc3333', [[32.8, -17.0], [32.81, -17.01], [32.82, -17.02], [32.83, -17.03]]],
};
const SHAPES = { url: '/shapes-all.json', metaUrl: '/shapes-all.meta.json' };
/** the archive server plus the two files of the route pack */
function site(file: Uint8Array, pack: Pack | null, opts: { rev?: string; failShapes?: boolean } = {}) {
  const arch = server(file);
  const requested: string[] = [];
  const text = JSON.stringify(pack);
  const fn = (async (u: RequestInfo | URL, init?: RequestInit) => {
    const href = String(u);
    requested.push(href);
    if (href === SHAPES.metaUrl) return pack ? Response.json({ rev: opts.rev ?? 'r1', count: Object.keys(pack).length, bytes: 1000, raw: 4000 }) : new Response('<!doctype html>', { status: 200 });
    if (href === SHAPES.url) return opts.failShapes ? new Response('x', { status: 500 }) : new Response(text);
    return arch.fn(u, init);
  }) as typeof fetch;
  return { fn, requested, calls: arch.calls };
}
const abs = (u: string) => new URL(u, 'http://localhost').href;
const pointsIn = async (cache: Cache, id: number, rev: string) => {
  const hit = await cache.match(shapeFileUrl(id, rev));
  return hit ? ((await hit.json()) as unknown) : undefined;
};

describe('route pack', () => {
  const file = archiveBytes(6000);
  it('probePack adds the routes to the size; without a pack on the server it is the archive alone', async () => {
    const withShapes = await probePack({ url: '/x', shapes: SHAPES, fetchFn: site(file, PACK).fn });
    expect(withShapes).toMatchObject({ size: 6000, total: 7000, shapes: { rev: 'r1', count: 3, bytes: 1000 } });
    const without = await probePack({ url: '/x', shapes: SHAPES, fetchFn: site(file, null).fn });
    expect(without).toMatchObject({ size: 6000, total: 6000, shapes: null });
  });

  it('unpacks every route under the key of a normal fetch, counts them in the progress and installs only with them', async () => {
    const cache = memoryCache();
    const shapesCache = memoryCache();
    const progress: Progress[] = [];
    const pack = await download({ url: '/x', shapes: SHAPES, cache, shapesCache, fetchFn: site(file, PACK).fn, chunkBytes: 2048, onProgress: (p) => progress.push(p) });
    expect(progress.at(-1)).toEqual({ done: 7000, total: 7000 });
    expect(pack.shapes).toMatchObject({ rev: 'r1', items: [[101, 'aaaa1111'], [102, 'bbbb2222'], [103, 'cccc3333']] });
    for (const [id, [rev, pts]] of Object.entries(PACK)) expect(await pointsIn(shapesCache, Number(id), rev)).toEqual(pts);
    expect((await shapesCache.keys()).map((k) => k.url).sort()).toEqual(Object.entries(PACK).map(([id, [rev]]) => abs(shapeFileUrl(Number(id), rev))).sort());
    expect(await readInstalled(cache)).toMatchObject({ shapes: { rev: 'r1' } });
  });

  it('a failing route download leaves nothing installed; the next try does not fetch the archive chunks again', async () => {
    const cache = memoryCache();
    const shapesCache = memoryCache();
    await expect(download({ url: '/x', shapes: SHAPES, cache, shapesCache, fetchFn: site(file, PACK, { failShapes: true }).fn, chunkBytes: 2048 })).rejects.toThrow(/routes/);
    expect(await readInstalled(cache)).toBeNull();
    expect(offlineMapInstalled()).toBe(false);
    const again = site(file, PACK);
    await download({ url: '/x', shapes: SHAPES, cache, shapesCache, fetchFn: again.fn, chunkBytes: 2048 });
    expect(again.calls).toEqual(['bytes=0-6']); // only the probe: all 3 chunks were kept
    expect(await readInstalled(cache)).toMatchObject({ chunks: 3, shapes: { rev: 'r1' } });
  });

  it('refuses a damaged pack (a route of one point) without storing any route', async () => {
    const shapesCache = memoryCache();
    const broken = { ...PACK, '104': ['dddd4444', [[1, 2]]] } as unknown as Pack;
    await expect(download({ url: '/x', shapes: SHAPES, cache: memoryCache(), shapesCache, fetchFn: site(file, broken).fn, chunkBytes: 2048 })).rejects.toThrow(/bad route 104/);
    expect(await shapesCache.keys()).toHaveLength(0);
  });

  it('new routes with the same archive replace only the routes, the unchanged archive is not downloaded again', async () => {
    const cache = memoryCache();
    const shapesCache = memoryCache();
    await download({ url: '/x', shapes: SHAPES, cache, shapesCache, fetchFn: site(file, PACK).fn, chunkBytes: 2048 });
    const next: Pack = { '101': ['aaaa1111', PACK['101'][1]], '102': ['b2b2b2b2', [[32.9, -16.7], [32.91, -16.71]]] };
    const s = site(file, next, { rev: 'r2' });
    const pack = await download({ url: '/x', shapes: SHAPES, cache, shapesCache, fetchFn: s.fn, chunkBytes: 2048 });
    expect(s.calls).toEqual(['bytes=0-6']);
    expect(pack.shapes?.rev).toBe('r2');
    expect(await pointsIn(shapesCache, 102, 'bbbb2222')).toBeUndefined(); // the old revision is gone
    expect(await pointsIn(shapesCache, 103, 'cccc3333')).toBeUndefined(); // a route that no longer exists
    expect(await pointsIn(shapesCache, 102, 'b2b2b2b2')).toEqual(next['102'][1]);
    expect(await pointsIn(shapesCache, 101, 'aaaa1111')).toEqual(PACK['101'][1]);
  });

  it('removing the pack deletes its routes and nothing else in the route cache', async () => {
    const cache = memoryCache();
    const shapesCache = memoryCache();
    await shapesCache.put(shapeFileUrl(999, 'seen-online'), Response.json([[1, 2], [3, 4]]));
    await download({ url: '/x', shapes: SHAPES, cache, shapesCache, fetchFn: site(file, PACK).fn, chunkBytes: 2048 });
    expect(await shapesCache.keys()).toHaveLength(4);
    await removeArchive(cache, shapesCache);
    expect((await shapesCache.keys()).map((k) => k.url)).toEqual([abs(shapeFileUrl(999, 'seen-online'))]);
    expect(await cache.keys()).toHaveLength(0);
    expect(offlineMapInstalled()).toBe(false);
  });
});

// what build:data really wrote, checked against the single route files and the schedules (independent of the code that wrote it)
describe.skipIf(!existsSync('public/data/shapes-all.json'))('the route pack built by build:data', () => {
  const pack = JSON.parse(readFileSync('public/data/shapes-all.json', 'utf8')) as Pack;
  const meta = JSON.parse(readFileSync('public/data/shapes-all.meta.json', 'utf8')) as { rev: string; count: number; raw: number; bytes: number };
  const schedules = JSON.parse(readFileSync('public/data/schedules.json', 'utf8')) as { lines: { directions: { shapeId: number | null; shapeRev?: string }[] }[] };
  const used = new Map<number, string>();
  for (const l of schedules.lines) for (const d of l.directions) if (d.shapeId != null) used.set(d.shapeId, d.shapeRev ?? '');

  it('has every route a direction draws, with the revision the app asks for', () => {
    expect(Object.keys(pack).map(Number).sort((a, b) => a - b)).toEqual([...used.keys()].sort((a, b) => a - b));
    for (const [id, rev] of used) expect(pack[id][0]).toBe(rev);
  });
  it('holds the geometry of the single route files, point for point', () => {
    for (const id of used.keys()) expect(pack[id][1]).toEqual(JSON.parse(readFileSync(`public/data/shapes/${id}.json`, 'utf8')));
  });
  it('is described by its meta file', () => {
    expect(meta.count).toBe(used.size);
    expect(meta.raw).toBe(statSync('public/data/shapes-all.json').size);
    expect(meta.bytes).toBeGreaterThan(0);
    expect(meta.bytes).toBeLessThan(meta.raw);
  });
});

describe('the test archive (scripts/make-test-pmtiles.mjs) through the offline source', () => {
  const file = 'tests/fixtures/madeira-test.pmtiles';
  it.skipIf(!existsSync(file))('is a valid PMTiles archive whose tiles decode with roads, land and places', async () => {
    const bytes = new Uint8Array(readFileSync(file));
    const cache = memoryCache();
    const s = server(bytes);
    const pack = await downloadArchive({ url: '/x', cache, fetchFn: s.fn, chunkBytes: 64 * 1024 });
    const archive = new PMTiles(new CacheArchiveSource(cache, pack));
    const header = await archive.getHeader();
    expect(header.tileType).toBe(1);
    expect(header.maxZoom).toBeGreaterThanOrEqual(12);
    // the tile over Funchal at z12
    const z = 12;
    const n = 2 ** z;
    const lat = 32.65;
    const lon = -16.92;
    const x = Math.floor(((lon + 180) / 360) * n);
    const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
    const tile = await archive.getZxy(z, x, y);
    expect(tile).toBeDefined();
    const vt = new VectorTile(new Pbf(new Uint8Array(tile!.data)));
    expect(Object.keys(vt.layers)).toEqual(expect.arrayContaining(['earth', 'roads']));
    expect(vt.layers.roads.length).toBeGreaterThan(0);
  });
});

describe('fmtBytes', () => {
  it('uses kB below a megabyte and MB above', () => {
    expect(fmtBytes(300 * 1024)).toBe('300 kB');
    expect(fmtBytes(8.4 * 1024 * 1024)).toBe('8.4 MB');
    expect(fmtBytes(250 * 1024 * 1024)).toBe('250 MB');
  });
});

// Offline map: ONE PMTiles archive (vector tiles of Madeira and Porto Santo), downloaded in chunks into Cache Storage.
// - One file instead of thousands of tiles: a few requests, a resumable download, an atomic install (the `meta` entry is written last).
// - The archive is read through `CacheArchiveSource`, a PMTiles `Source` that serves byte ranges out of the stored chunks.
// - Nothing here touches the OpenStreetMap tile servers; the archive is hosted with the app (see ARCHIVE_URL).
// Only types are imported from 'pmtiles' (this module is part of the first screen's bundle through the settings page).
import type { RangeResponse, Source } from 'pmtiles';

/** The archive, hosted next to the app. Served with HTTP Range support (static hosting does that). */
export const ARCHIVE_URL = `${import.meta.env.BASE_URL}maps/madeira.pmtiles`;
export const CHUNK_BYTES = 2 * 1024 * 1024;

const CACHE_NAME = 'offline-maps-v1';
const FLAG_KEY = 'offlineMap';
/** Cache Storage wants URLs as keys; these are never fetched, and no service worker rule matches them. */
const key = (name: string) => `https://offline-maps.invalid/madeira/${name}`;
const chunkKey = (i: number) => key(`chunk-${i}`);
const META = key('meta');
const PARTIAL = key('partial');

/** What identifies one version of the archive on the server. */
export interface ArchiveInfo {
  version: string;
  size: number;
}
export interface InstalledPack extends ArchiveInfo {
  chunks: number;
  chunkBytes: number;
  at: number;
}
export interface Probe extends ArchiveInfo {
  /** the server answers byte-range requests */
  ranges: boolean;
}
export interface Progress {
  done: number;
  total: number;
}

export const cachesAvailable = () => typeof caches !== 'undefined';
const openCache = () => caches.open(CACHE_NAME);

/** Synchronous answer for the map code: is a pack installed on this device? (the flag is written after a complete install) */
export function installedFlag(): ArchiveInfo | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FLAG_KEY) ?? 'null');
    return v && typeof v === 'object' && typeof (v as ArchiveInfo).version === 'string' && typeof (v as ArchiveInfo).size === 'number' ? (v as ArchiveInfo) : null;
  } catch {
    return null;
  }
}
export const offlineMapInstalled = () => installedFlag() !== null;
function setFlag(info: ArchiveInfo | null) {
  try {
    if (info) localStorage.setItem(FLAG_KEY, JSON.stringify({ version: info.version, size: info.size }));
    else localStorage.removeItem(FLAG_KEY);
  } catch {
    /* storage unavailable: the maps just do not switch to the offline pack */
  }
}

async function readJson<T>(cache: Cache, url: string): Promise<T | null> {
  const hit = await cache.match(url);
  if (!hit) return null;
  try {
    return (await hit.json()) as T;
  } catch {
    return null;
  }
}
const putJson = (cache: Cache, url: string, value: unknown) => cache.put(url, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }));

/** The pack in Cache Storage (complete installs only), or null. Also repairs the synchronous flag. */
export async function readInstalled(cache?: Cache): Promise<InstalledPack | null> {
  if (!cache && !cachesAvailable()) return null;
  const c = cache ?? (await openCache());
  const meta = await readJson<InstalledPack>(c, META);
  const ok = !!meta && Number.isInteger(meta.chunks) && meta.chunks > 0 && !!(await c.match(chunkKey(0))) && !!(await c.match(chunkKey(meta.chunks - 1)));
  if (!ok) {
    setFlag(null);
    return null;
  }
  setFlag(meta);
  return meta;
}

/**
 * Size and version of the archive on the server. Rejects when the URL does not serve a PMTiles file (a 404, or the app's own index.html
 * that a single-page host answers for unknown paths), so the settings page can hide the feature until the file exists.
 */
export async function probeArchive(url = ARCHIVE_URL, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<Probe> {
  const res = await fetchFn(url, { headers: { Range: 'bytes=0-6' }, signal });
  if (res.status !== 206 && res.status !== 200) throw new Error(`archive: HTTP ${res.status}`);
  const magic = new TextDecoder().decode(new Uint8Array(await readHead(res, 7)));
  if (magic !== 'PMTiles') throw new Error('archive: not a PMTiles file');
  let size: number;
  if (res.status === 206) {
    const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
    if (!m) throw new Error('archive: no total size');
    size = Number(m[1]);
  } else {
    size = Number(res.headers.get('content-length'));
  }
  if (!Number.isFinite(size) || size < 127) throw new Error('archive: bad size');
  const version = (res.headers.get('etag') ?? res.headers.get('last-modified') ?? String(size)).replace(/^W\//, '').replace(/"/g, '');
  return { version, size, ranges: res.status === 206 };
}

/** The first `n` bytes of a response; a full 200 response is cancelled after them. */
async function readHead(res: Response, n: number): Promise<ArrayBuffer> {
  if (!res.body) return (await res.arrayBuffer()).slice(0, n);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let have = 0;
  while (have < n) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    have += value.length;
  }
  await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(have);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out.slice(0, n).buffer;
}

export interface DownloadOptions {
  url?: string;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
  cache?: Cache;
  fetchFn?: typeof fetch;
  chunkBytes?: number;
}

async function clearAll(cache: Cache) {
  for (const req of await cache.keys()) await cache.delete(req);
}

/**
 * Downloads the archive chunk by chunk into Cache Storage and installs it. A download that was interrupted (offline, cancelled, tab closed) is
 * continued with the chunks already stored; a pack of another version is replaced. The pack counts as installed only when every chunk is there.
 */
export async function downloadArchive(opts: DownloadOptions = {}): Promise<InstalledPack> {
  const { url = ARCHIVE_URL, signal, onProgress, fetchFn = fetch } = opts;
  const chunkBytes = opts.chunkBytes ?? CHUNK_BYTES;
  const cache = opts.cache ?? (await openCache());
  const probe = await probeArchive(url, fetchFn, signal);
  const chunks = Math.ceil(probe.size / chunkBytes);

  const installed = await readJson<InstalledPack>(cache, META);
  if (installed && installed.version === probe.version && installed.size === probe.size && installed.chunks === chunks) {
    onProgress?.({ done: probe.size, total: probe.size });
    return installed;
  }
  // a half-finished download of this very version is continued, anything else starts clean
  const partial = await readJson<ArchiveInfo & { chunkBytes: number }>(cache, PARTIAL);
  if (!partial || partial.version !== probe.version || partial.size !== probe.size || partial.chunkBytes !== chunkBytes || installed) {
    setFlag(null); // the old pack is replaced: until the new one is complete the maps use the online tiles
    await clearAll(cache);
  }
  await putJson(cache, PARTIAL, { version: probe.version, size: probe.size, chunkBytes });

  const span = (i: number) => ({ start: i * chunkBytes, end: Math.min(probe.size, (i + 1) * chunkBytes) - 1 });
  let done = 0;
  const have: boolean[] = [];
  for (let i = 0; i < chunks; i++) {
    have[i] = !!(await cache.match(chunkKey(i)));
    if (have[i]) done += span(i).end - span(i).start + 1;
  }
  onProgress?.({ done, total: probe.size });

  const store = async (i: number, data: ArrayBuffer) => {
    await cache.put(chunkKey(i), new Response(data, { headers: { 'content-type': 'application/octet-stream' } }));
    const n = data.byteLength;
    done += n;
    onProgress?.({ done, total: probe.size });
  };
  const missing = have.map((h, i) => (h ? -1 : i)).filter((i) => i >= 0);
  if (missing.length && !probe.ranges) {
    // no byte ranges on this server: one download of the whole file, cut into chunks
    const res = await fetchFn(url, { signal });
    if (!res.ok) throw new Error(`archive: HTTP ${res.status}`);
    const all = await res.arrayBuffer();
    if (all.byteLength !== probe.size) throw new Error('archive: incomplete download');
    for (const i of missing) {
      const { start, end } = span(i);
      await store(i, all.slice(start, end + 1));
    }
  } else {
    for (const i of missing) {
      const { start, end } = span(i);
      const res = await fetchFn(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
      if (res.status !== 206) throw new Error(`archive: HTTP ${res.status} for a byte range`);
      const data = await res.arrayBuffer();
      if (data.byteLength !== end - start + 1) throw new Error('archive: short chunk');
      await store(i, data);
    }
  }
  const pack: InstalledPack = { version: probe.version, size: probe.size, chunks, chunkBytes, at: Date.now() };
  await putJson(cache, META, pack); // the commit: from here on the pack is installed
  await cache.delete(PARTIAL);
  setFlag(pack);
  return pack;
}

/** Deletes the installed pack and any half-finished download. */
export async function removeArchive(cache?: Cache): Promise<void> {
  setFlag(null);
  if (!cache && !cachesAvailable()) return;
  await clearAll(cache ?? (await openCache()));
}

/** A PMTiles `Source` that answers byte-range reads from the chunks in Cache Storage. */
export class CacheArchiveSource implements Source {
  private recent = new Map<number, Promise<Uint8Array>>();
  constructor(
    private cache: Cache,
    private pack: InstalledPack,
  ) {}

  getKey() {
    return `offline-maps:${this.pack.version}`;
  }

  private chunk(i: number): Promise<Uint8Array> {
    let p = this.recent.get(i);
    if (p) {
      this.recent.delete(i);
    } else {
      p = this.cache.match(chunkKey(i)).then(async (res) => {
        if (!res) throw new Error(`offline map: chunk ${i} is missing`);
        return new Uint8Array(await res.arrayBuffer());
      });
      p.catch(() => this.recent.delete(i));
    }
    this.recent.set(i, p); // most recently used last; a few chunks are kept so neighbouring tiles do not re-read them
    if (this.recent.size > 6) this.recent.delete(this.recent.keys().next().value as number);
    return p;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const end = Math.min(this.pack.size, offset + length);
    const out = new Uint8Array(Math.max(0, end - offset));
    const { chunkBytes } = this.pack;
    for (let i = Math.floor(offset / chunkBytes); i * chunkBytes < end; i++) {
      const data = await this.chunk(i);
      const from = Math.max(offset, i * chunkBytes);
      const to = Math.min(end, (i + 1) * chunkBytes);
      out.set(data.subarray(from - i * chunkBytes, to - i * chunkBytes), from - offset);
    }
    return { data: out.buffer };
  }
}

/** The source of the installed pack; rejects when none is installed. */
export async function installedSource(): Promise<CacheArchiveSource> {
  const cache = await openCache();
  const pack = await readInstalled(cache);
  if (!pack) throw new Error('offline map: not installed');
  return new CacheArchiveSource(cache, pack);
}

export interface StorageStatus {
  usage: number;
  quota: number;
  persisted: boolean;
}
/** How much room the browser gives this site, and whether it promised not to evict it. */
export async function storageStatus(): Promise<StorageStatus | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, persisted: (await navigator.storage.persisted?.()) ?? false };
  } catch {
    return null;
  }
}
/** Asks the browser not to evict the site's storage when the device runs low (a user-visible prompt on some browsers; refusal is fine). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 ** 2).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} kB`;
}

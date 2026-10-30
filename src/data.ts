import { useEffect, useMemo, useState } from 'react';
import type { Dataset, Line, ViaRoutes } from './types';
import { buildIndex } from './lib/search';
import { decodeEntitiesInJson } from './lib/text';
import { datasetProblem, isShape, isViaRoutes } from './lib/validate';
import { shapeFileUrl } from './lib/shapeUrl';

const url = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/** Where the last dataset that passed the check is kept (Cache Storage: far more room than localStorage, and the service worker leaves it alone). */
export interface LastGoodStore {
  read(): Promise<string | null>;
  write(text: string, stamp: string): Promise<void>;
}

const LAST_GOOD_CACHE = 'dataset-last-good';
const LAST_GOOD_URL = url('data/last-good.json');

const cacheLastGood: LastGoodStore = {
  async read() {
    if (typeof caches === 'undefined') return null;
    const hit = await (await caches.open(LAST_GOOD_CACHE)).match(LAST_GOOD_URL);
    return hit ? hit.text() : null;
  },
  async write(text, stamp) {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(LAST_GOOD_CACHE);
    // the same build again: nothing to rewrite (the file is ~2 MB)
    if ((await cache.match(LAST_GOOD_URL))?.headers.get('x-stamp') === stamp) return;
    await cache.put(LAST_GOOD_URL, new Response(text, { headers: { 'content-type': 'application/json', 'x-stamp': stamp } }));
  },
};

function parseDataset(txt: string): Dataset {
  const d: unknown = JSON.parse(decodeEntitiesInJson(txt));
  const problem = datasetProblem(d);
  if (problem) throw new Error(`timetable data rejected: ${problem}`);
  return d as Dataset;
}

/**
 * The timetable dataset: freshly fetched when it passes the check (and then remembered as the last good copy); when the download fails or
 * the data is damaged (truncated, wrong build, an error page in place of the JSON) the last good copy is used instead, silently. Only with
 * neither does it reject, and the app shows its "data unavailable" page.
 */
export async function loadDataset(fetchText: () => Promise<string>, store: LastGoodStore = cacheLastGood): Promise<Dataset> {
  try {
    const txt = await fetchText();
    const d = parseDataset(txt);
    void store.write(txt, `${d.generatedAt}|${txt.length}`).catch(() => undefined);
    return d;
  } catch (e) {
    console.warn('Timetable data unusable, trying the last good copy:', e);
    const old = await store.read().catch(() => null);
    if (old) {
      try {
        return parseDataset(old);
      } catch (e2) {
        console.warn('The last good copy is unusable too:', e2);
      }
    }
    throw e;
  }
}

const fetchSchedules = () => fetch(url('data/schedules.json')).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));

export function useDataset() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    loadDataset(fetchSchedules)
      .then((d) => {
        registerShapeRevs(d.lines);
        if (alive) setData(d);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);
  const index = useMemo(() => (data ? buildIndex(data.lines) : null), [data]);
  return { data, index, error };
}

export const assetUrl = url;

/**
 * Route files are cached under the content hash of the file (`dir.shapeRev`, from build:data): an app update keeps every route whose geometry did
 * not change, so the routes a traveller opened before the trip are still there offline. Filled when the dataset arrives.
 */
const shapeRevs = new Map<number, string>();
function registerShapeRevs(lines: readonly Line[]) {
  for (const l of lines) for (const d of l.directions) if (d.shapeId !== null && d.shapeRev) shapeRevs.set(d.shapeId, d.shapeRev);
}
const shapeUrl = (shapeId: number) => shapeFileUrl(shapeId, shapeRevs.get(shapeId) ?? '0');

/** Drops the cached copies of routes whose geometry changed (their hash is not the current one) and of routes that no longer exist. */
export async function pruneShapeCache(): Promise<void> {
  try {
    if (typeof caches === 'undefined' || !shapeRevs.size) return;
    const cache = await caches.open('shapes');
    for (const req of await cache.keys()) {
      const u = new URL(req.url);
      const id = Number(/\/shapes\/(\d+)\.json$/.exec(u.pathname)?.[1]);
      if (shapeRevs.get(id) !== u.searchParams.get('v')) await cache.delete(req);
    }
  } catch {
    // no Cache Storage (private mode, tests): nothing to prune
  }
}

/** public/data/shapes-all.json: every route in one file, `{ id: [rev, points] }` (precached with the app, so it is there offline). */
type ShapePack = Record<string, [string, [number, number][]]>;
let shapePack: Promise<ShapePack> | undefined;
function loadShapePack(): Promise<ShapePack> {
  shapePack ??= fetch(url('data/shapes-all.json'))
    .then((r) => (r.ok ? (r.json() as Promise<ShapePack>) : Promise.reject(new Error(String(r.status)))))
    .catch((e) => {
      shapePack = undefined; // retried the next time a route is missing
      throw e;
    });
  return shapePack;
}

async function fetchShape(shapeId: number): Promise<[number, number][]> {
  const r = await fetch(shapeUrl(shapeId));
  if (!r.ok) throw new Error(String(r.status));
  const pts: unknown = await r.json();
  if (!isShape(pts)) throw new Error(`route ${shapeId}: not a list of points`);
  return pts;
}

/** A route: its own file (cached when first opened); when that cannot be had (offline, not opened before), the copy in the precached pack of all routes. */
export async function loadShape(shapeId: number): Promise<[number, number][]> {
  try {
    return await fetchShape(shapeId);
  } catch (e) {
    try {
      const entry = (await loadShapePack())[String(shapeId)];
      const rev = shapeRevs.get(shapeId);
      if (entry && (!rev || entry[0] === rev) && isShape(entry[1])) return entry[1];
    } catch {
      // no pack either: the original error below
    }
    throw e;
  }
}

const viaLoaded = new Map<number, Promise<ViaRoutes>>();
/** The detour routes of a line (public/data/via/<id>.json, precached); {} when they cannot be had: the map then draws the plain route. Never rejects. */
function loadViaRoutes(lineId: number): Promise<ViaRoutes> {
  let p = viaLoaded.get(lineId);
  if (!p) {
    p = fetch(url(`data/via/${lineId}.json`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: unknown) => (isViaRoutes(j) ? (j as ViaRoutes) : Promise.reject(new Error('detour routes: bad shape'))))
      .catch(() => {
        viaLoaded.delete(lineId); // retried the next time the line is opened
        return {} as ViaRoutes;
      });
    viaLoaded.set(lineId, p);
  }
  return p;
}

/** Detour routes of the given lines, loaded when first needed (only lines with `hasViaRoutes`); the map re-renders when a file arrives. */
export function useViaRoutes(lines: readonly Pick<Line, 'id' | 'hasViaRoutes'>[]): ReadonlyMap<number, ViaRoutes> {
  const ids = lines.filter((l) => l.hasViaRoutes).map((l) => l.id);
  const sig = ids.join(',');
  const [loaded, setLoaded] = useState<ReadonlyMap<number, ViaRoutes>>(() => new Map());
  useEffect(() => {
    let alive = true;
    for (const id of ids) {
      void loadViaRoutes(id).then((r) => {
        if (alive && Object.keys(r).length) setLoaded((m) => (m.has(id) ? m : new Map(m).set(id, r)));
      });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return loaded;
}

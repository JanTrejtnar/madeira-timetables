import { useEffect, useMemo, useState } from 'react';
import type { Dataset, Line, ViaRoutes } from './types';
import { buildIndex } from './lib/search';
import { decodeEntitiesInJson } from './lib/text';

const url = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export function useDataset() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(url('data/schedules.json'))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((txt) => JSON.parse(decodeEntitiesInJson(txt)) as Dataset)
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
export function registerShapeRevs(lines: readonly Line[]) {
  for (const l of lines) for (const d of l.directions) if (d.shapeId !== null && d.shapeRev) shapeRevs.set(d.shapeId, d.shapeRev);
}
const shapeUrl = (shapeId: number) => url(`data/shapes/${shapeId}.json?v=${shapeRevs.get(shapeId) ?? '0'}`);

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

export async function loadShape(shapeId: number): Promise<[number, number][]> {
  const r = await fetch(shapeUrl(shapeId));
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

const viaLoaded = new Map<number, Promise<ViaRoutes>>();
/** The detour routes of a line (public/data/via/<id>.json, precached); {} when they cannot be had: the map then draws the plain route. Never rejects. */
export function loadViaRoutes(lineId: number): Promise<ViaRoutes> {
  let p = viaLoaded.get(lineId);
  if (!p) {
    p = fetch(url(`data/via/${lineId}.json`))
      .then((r) => (r.ok ? (r.json() as Promise<ViaRoutes>) : Promise.reject(new Error(String(r.status)))))
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

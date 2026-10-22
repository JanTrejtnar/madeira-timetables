import { useEffect, useMemo, useState } from 'react';
import type { Dataset } from './types';
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
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);
  const index = useMemo(() => (data ? buildIndex(data.lines) : null), [data]);
  return { data, index, error };
}

export const assetUrl = url;

/** Route files are cached per build stamp; this removes the copies of older builds (the `shapes` cache would otherwise keep both). */
export async function pruneShapeCache(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open('shapes');
    const keep = `?v=${encodeURIComponent(__BUILD_TIME__)}`;
    for (const req of await cache.keys()) if (!req.url.endsWith(keep)) await cache.delete(req);
  } catch {
    // no Cache Storage (private mode, tests): nothing to prune
  }
}

export async function loadShape(shapeId: number): Promise<[number, number][]> {
  // the build stamp in the URL: a regenerated route is never served from the cache of an older build (the file names stay the same)
  const r = await fetch(url(`data/shapes/${shapeId}.json?v=${encodeURIComponent(__BUILD_TIME__)}`));
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

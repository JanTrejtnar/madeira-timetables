import { useEffect, useMemo, useState } from 'react';
import type { Dataset } from './types';
import { buildIndex } from './lib/search';

const url = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export function useDataset() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(url('data/schedules.json'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Dataset) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);
  const index = useMemo(() => (data ? buildIndex(data.lines) : null), [data]);
  return { data, index, error };
}

export const assetUrl = url;

export async function loadShape(shapeId: number): Promise<[number, number][]> {
  const r = await fetch(url(`data/shapes/${shapeId}.json`));
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

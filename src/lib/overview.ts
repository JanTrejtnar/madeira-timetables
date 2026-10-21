// public/data/overview.json: per line the simplified road geometry (scripts/lib-overview.mjs) and the weekday runs.
import { assetUrl } from '../data';

export interface Overview {
  lines: { i: number; t: number; p: number[][] }[];
}

let promise: Promise<Overview> | null = null;
/** Loads the file once (it is precached by the service worker, so it also works offline). */
export function loadOverview(): Promise<Overview> {
  promise ??= fetch(assetUrl('data/overview.json'))
    .then((r) => (r.ok ? (r.json() as Promise<Overview>) : Promise.reject(new Error(String(r.status)))))
    .catch((e) => {
      promise = null;
      throw e;
    });
  return promise;
}

/** [lat0, lon0, dLat, dLon, ...] in 1e-5 degrees -> [lat, lon] pairs */
export function decodeSegment(flat: number[]): [number, number][] {
  const out: [number, number][] = [];
  let la = 0;
  let lo = 0;
  for (let k = 0; k + 1 < flat.length; k += 2) {
    la += flat[k];
    lo += flat[k + 1];
    out.push([la / 1e5, lo / 1e5]);
  }
  return out;
}

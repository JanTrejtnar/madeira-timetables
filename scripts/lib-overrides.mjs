// Manual stop positions (data/stop-overrides.json) that win over every automatic source.
import { keyOf } from './lib-coords.mjs';

/** Applies the overrides to every matching stop; returns the number of stops changed. */
export function applyOverrides(lines, file) {
  const list = (file.overrides ?? []).map((o) => ({ ...o, key: keyOf(o.name) }));
  let n = 0;
  for (const l of lines) {
    for (const d of l.directions) {
      for (const s of d.stops) {
        const k = keyOf(s.name);
        const o = list.find((x) => x.key === k && (!x.lines || x.lines.includes(l.number)));
        if (!o) continue;
        for (const f of ['approx', 'isEstimatedLocation']) delete s[f];
        const precision = o.locationPrecision ?? 'exact';
        // an exact override is an official position; anything else stays flagged as approximate
        Object.assign(s, { lat: o.lat, lon: o.lon, source: 'override', locationPrecision: precision, ...(precision !== 'exact' ? { approx: true } : {}), ...(o.osmNode ? { osmNode: o.osmNode } : {}) });
        n++;
      }
    }
  }
  return n;
}

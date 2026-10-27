// Municipality (concelho) and parish (freguesia) of a point from the OSM boundary polygons (data/osm/areas.json).
// A point just outside every polygon (coast, simplified outline) takes the area whose outline is closest, up to 400 m.
import { metresToSegment } from '../shared/geo.mjs';
const rad = Math.PI / 180;

function inRing(ring, lat, lon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const bboxOf = (ring) => {
  let a = 90, b = 180, c = -90, d = -180;
  for (const [y, x] of ring) { a = Math.min(a, y); b = Math.min(b, x); c = Math.max(c, y); d = Math.max(d, x); }
  return [a, b, c, d];
};
const segDist = metresToSegment;

/** Prepares the polygons: bounding boxes, the municipality of every parish and a unique label per parish. */
export function prepareAreas(raw) {
  const areas = raw.areas.map((a) => ({ ...a, rings: a.rings.map((r) => ({ pts: r, box: bboxOf(r) })) }));
  const munis = areas.filter((a) => a.level === 7);
  const parishes = areas.filter((a) => a.level === 8);
  for (const p of parishes) {
    // municipality of the parish: the one containing a point well inside its largest ring
    const big = p.rings.reduce((m, r) => (r.pts.length > m.pts.length ? r : m));
    const cy = big.pts.reduce((s, q) => s + q[0], 0) / big.pts.length;
    const cx = big.pts.reduce((s, q) => s + q[1], 0) / big.pts.length;
    const probe = inRing(big.pts, cy, cx) ? [cy, cx] : [big.pts[0][0] + (cy - big.pts[0][0]) * 0.05, big.pts[0][1] + (cx - big.pts[0][1]) * 0.05];
    p.muni = munis.find((m) => m.rings.some((r) => inRing(r.pts, probe[0], probe[1])))?.name ?? null;
  }
  // parishes sharing a name (Santo António da Serra exists in two municipalities) get ", <municipality>"
  const count = new Map();
  for (const p of parishes) count.set(p.name, (count.get(p.name) ?? 0) + 1);
  for (const p of parishes) p.label = count.get(p.name) > 1 && p.muni ? `${p.name}, ${p.muni}` : p.name;
  return { munis, parishes };
}

function find(list, lat, lon) {
  for (const a of list) for (const r of a.rings) if (lat >= r.box[0] && lat <= r.box[2] && lon >= r.box[1] && lon <= r.box[3] && inRing(r.pts, lat, lon)) return a;
  return null;
}
function closest(list, lat, lon, maxM) {
  let best = null;
  let bd = maxM;
  for (const a of list) {
    for (const r of a.rings) {
      for (let i = 1; i < r.pts.length; i++) {
        const d = segDist([lat, lon], r.pts[i - 1], r.pts[i]);
        if (d < bd) { bd = d; best = a; }
      }
    }
  }
  return best;
}

/** { muni, parish } of a point (either may be null). */
export function areaOf(areas, lat, lon) {
  const parish = find(areas.parishes, lat, lon) ?? closest(areas.parishes, lat, lon, 400);
  const muni = find(areas.munis, lat, lon) ?? (parish?.muni ? areas.munis.find((m) => m.name === parish.muni) : null) ?? closest(areas.munis, lat, lon, 400);
  return { muni: muni?.name ?? parish?.muni ?? null, parish: parish?.label ?? null };
}

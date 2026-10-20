// Downloads bus stops (highway=bus_stop, public_transport=platform) and the parish (freguesia) / municipality (concelho)
// boundaries of Madeira from OpenStreetMap via the Overpass API. Used by build:data to place stops that neither SIGA nor
// the Horários do Funchal GTFS feed gives coordinates for, and to assign every stop to its parish.
// `npm run fetch:osm` -> data/osm/stops.json, data/osm/areas.json (committed; build:data needs no network).
// Data (c) OpenStreetMap contributors, ODbL.
import { mkdirSync, writeFileSync } from 'node:fs';

const ENDPOINTS = (process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']);
const OUT = new URL('../data/osm/', import.meta.url);
// Madeira, Porto Santo; the Desertas / Selvagens have no bus stops
const BBOX = '32.35,-17.35,33.20,-16.20';

async function overpass(query) {
  let last;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'madeira-timetables (offline PWA; build-time data fetch)' }, body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(170_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        last = new Error(`${url}: ${e.message}`);
        console.error(last.message);
        await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
      }
    }
  }
  throw last;
}

const round = (x) => +x.toFixed(6);
const stopsRaw = await overpass(`[out:json][timeout:120];(node["highway"="bus_stop"](${BBOX});node["public_transport"="platform"](${BBOX});node["public_transport"="stop_position"]["bus"="yes"](${BBOX}););out;`);
const stops = [];
const seen = new Set();
for (const e of stopsRaw.elements) {
  if (e.type !== 'node' || seen.has(e.id)) continue;
  seen.add(e.id);
  const t = e.tags ?? {};
  const name = (t.name ?? t['name:pt'] ?? '').trim();
  stops.push({ id: e.id, name, ...(t.ref ? { ref: t.ref } : {}), ...(t.alt_name ? { alt: t.alt_name } : {}), ...(t.network ? { network: t.network } : {}), lat: round(e.lat), lon: round(e.lon) });
}

// boundaries: admin_level 7 = concelho, 8 = freguesia (Portugal); geometry as rings, simplified
const areasRaw = await overpass(`[out:json][timeout:180];(relation["boundary"="administrative"]["admin_level"~"^(7|8)$"]["name"](${BBOX}););out geom;`);
const simplify = (pts, eps) => {
  // Douglas-Peucker on lat/lon (eps in degrees)
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0;
    let mi = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      const [x1, y1] = pts[a];
      const [x2, y2] = pts[b];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const l2 = dx * dx + dy * dy || 1e-18;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2));
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
};
/** Joins the outer ways of a relation into closed rings. */
function rings(rel) {
  const ways = rel.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry?.length > 1).map((m) => m.geometry.map((g) => [g.lat, g.lon]));
  const out = [];
  const key = (p) => p[0] + ',' + p[1];
  const pool = ways.slice();
  while (pool.length) {
    let cur = pool.pop();
    let grew = true;
    while (grew && key(cur[0]) !== key(cur[cur.length - 1])) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        if (key(w[0]) === key(cur[cur.length - 1])) cur = cur.concat(w.slice(1));
        else if (key(w[w.length - 1]) === key(cur[cur.length - 1])) cur = cur.concat(w.slice(0, -1).reverse());
        else if (key(w[w.length - 1]) === key(cur[0])) cur = w.concat(cur.slice(1));
        else if (key(w[0]) === key(cur[0])) cur = w.slice(1).reverse().concat(cur);
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 4) out.push(cur);
  }
  return out;
}
const areas = areasRaw.elements
  .filter((e) => e.type === 'relation')
  .map((e) => ({
    id: e.id,
    name: e.tags.name,
    level: +e.tags.admin_level,
    rings: rings(e).map((r) => simplify(r, 0.0002).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)])),
  }))
  .filter((a) => a.rings.length);

// named places (villages, hamlets, suburbs): a stop named after its village falls back to the village centre
const placesRaw = await overpass(`[out:json][timeout:120];node["place"~"^(city|town|village|hamlet|suburb|locality|neighbourhood|isolated_dwelling)$"]["name"](${BBOX});out;`);
const places = placesRaw.elements.filter((e) => e.type === 'node' && e.tags?.name).map((e) => ({ name: e.tags.name, place: e.tags.place, lat: round(e.lat), lon: round(e.lon) }));

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('places.json', OUT), JSON.stringify({ source: 'OpenStreetMap contributors (ODbL) via Overpass API', fetched: new Date().toISOString().slice(0, 10), places }));
writeFileSync(new URL('stops.json', OUT), JSON.stringify({ source: 'OpenStreetMap contributors (ODbL) via Overpass API', fetched: new Date().toISOString().slice(0, 10), stops }));
writeFileSync(new URL('areas.json', OUT), JSON.stringify({ source: 'OpenStreetMap contributors (ODbL) via Overpass API', fetched: new Date().toISOString().slice(0, 10), areas }));
console.log(`OSM: ${places.length} places, ${stops.length} stops (${stops.filter((s) => s.name).length} named), ${areas.filter((a) => a.level === 7).length} municipalities, ${areas.filter((a) => a.level === 8).length} parishes`);

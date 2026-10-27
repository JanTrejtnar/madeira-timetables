// Downloads the named points of interest of Madeira and Porto Santo from OpenStreetMap (Overpass API): beaches, peaks, viewpoints,
// attractions, museums, parks, levadas, harbours, ferry terminals, malls, hotels, hospitals, the airport and notable churches / monuments.
// The planner's autocomplete offers them next to the bus stops; build:data merges them with data/pois-curated.json and the towns of
// data/osm/places.json into public/data/pois.json.
// `npm run fetch:pois` -> data/osm/pois.json (committed; build:data needs no network). Data (c) OpenStreetMap contributors, ODbL.
import { mkdirSync, writeFileSync } from 'node:fs';
import { metres } from '../shared/geo.mjs';

const ENDPOINTS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const OUT = new URL('../data/osm/', import.meta.url);
const BBOX = '32.35,-17.35,33.20,-16.20';
const UA = 'madeira-timetables (offline PWA; build-time data fetch)';

async function overpass(query) {
  let last;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(170_000) });
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

/** [filter, kind]: the first filter an element matches decides its kind (see kindOf) */
const FILTERS = [
  'nwr["natural"="beach"]["name"]',
  'nwr["natural"="peak"]["name"]',
  'nwr["natural"~"^(cape|bay|waterfall)$"]["name"]',
  'nwr["waterway"="waterfall"]["name"]',
  'nwr["tourism"~"^(viewpoint|attraction|museum|gallery|zoo|theme_park|hotel)$"]["name"]',
  'nwr["leisure"~"^(park|garden|nature_reserve|marina|stadium|water_park)$"]["name"]',
  'nwr["boundary"="protected_area"]["name"]',
  'nwr["amenity"~"^(ferry_terminal|hospital|marketplace|theatre|casino|university|bus_station)$"]["name"]',
  'nwr["shop"="mall"]["name"]',
  'nwr["aeroway"="aerodrome"]["name"]',
  'nwr["aerialway"="station"]["name"]',
  'nwr["highway"="trailhead"]["name"]',
  'nwr["historic"]["name"]["wikidata"]',
  'nwr["amenity"="place_of_worship"]["name"]["wikidata"]',
  'way["waterway"="canal"]["name"~"^Levada",i]',
  'nwr["man_made"~"^(pier|lighthouse)$"]["name"]',
];

/** The app's category of a mapped feature (undefined: left out). */
export function kindOf(t) {
  if (t.aeroway === 'aerodrome') return 'airport';
  if (t.aerialway === 'station') return 'cable_car';
  if (t.amenity === 'ferry_terminal') return 'harbor';
  if (t.amenity === 'bus_station') return 'bus_station';
  if (t.amenity === 'hospital') return 'hospital';
  if (t.amenity === 'marketplace') return 'market';
  if (t.amenity === 'theatre' || t.amenity === 'casino') return 'attraction';
  if (t.amenity === 'university') return 'attraction';
  if (t.amenity === 'place_of_worship') return 'church';
  if (t.shop === 'mall') return 'mall';
  if (t.tourism === 'hotel') return 'hotel';
  if (t.tourism === 'museum' || t.tourism === 'gallery') return 'museum';
  if (t.tourism === 'viewpoint') return 'viewpoint';
  if (t.tourism) return 'attraction';
  if (t.natural === 'beach') return 'beach';
  if (t.natural === 'peak') return 'peak';
  if (t.natural === 'cape' || t.natural === 'bay' || t.natural === 'waterfall' || t.waterway === 'waterfall') return 'nature';
  if (t.waterway === 'canal') return 'levada';
  if (t.leisure === 'marina') return 'harbor';
  if (t.leisure === 'stadium' || t.leisure === 'water_park') return 'attraction';
  if (t.leisure) return 'park';
  if (t.boundary === 'protected_area') return 'park';
  if (t.man_made === 'pier') return 'harbor';
  if (t.man_made === 'lighthouse') return 'viewpoint';
  if (t.highway === 'trailhead') return 'trail';
  if (t.historic) return 'attraction';
  return undefined;
}

const round = (v) => +v.toFixed(5);
const query = `[out:json][timeout:170];(${FILTERS.map((f) => `${f}(${BBOX});`).join('')});out tags center;`;
const raw = await overpass(query);
const byKey = new Map();
for (const e of raw.elements) {
  const t = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  const kind = kindOf(t);
  const name = (t.name ?? '').trim();
  if (!kind || !name || lat === undefined || lon === undefined) continue;
  // a peak below 700 m is not a destination; a hotel is kept only when it is a real one (stars or Wikidata), the rest is a guesthouse
  if (kind === 'peak' && !(+String(t.ele ?? '').replace(',', '.') >= 700 || t.wikidata)) continue;
  if (kind === 'trail' && !/pico|ponta|vereda|levada|cabo/i.test(name)) continue;
  const alt = [t['name:en'], t['name:cs'], t['name:de'], t.alt_name, t.short_name, t.old_name].filter((x) => x && x !== name);
  const p = { name, kind, lat: round(lat), lon: round(lon), ...(alt.length ? { alt: [...new Set(alt)].slice(0, 4) } : {}), ...(t.wikidata ? { w: 1 } : {}) };
  // the same name and kind within 300 m is one feature (a museum mapped as a node and as a building)
  const key = `${kind}|${name.toLowerCase()}`;
  const same = byKey.get(key) ?? [];
  if (same.some((q) => metres(q, p) < 300)) continue;
  same.push(p);
  byKey.set(key, same);
}
const places = [...byKey.values()].flat().sort((a, b) => a.name.localeCompare(b.name, 'pt'));
const counts = {};
for (const p of places) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('pois.json', OUT), JSON.stringify({ source: 'OpenStreetMap contributors (ODbL) via Overpass API', fetched: new Date().toISOString().slice(0, 10), places }) + '\n');
console.log('data/osm/pois.json:', places.length, 'places', JSON.stringify(counts));

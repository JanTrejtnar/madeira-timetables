// Stop coordinates from OpenStreetMap (data/osm/stops.json, `npm run fetch:osm`) for stops that neither SIGA nor the
// Horários do Funchal feed place. Matching is by normalised name, disambiguated by the route polyline, the neighbouring
// stops and finally the municipality of the line. Matched stops are marked `approx: true, source: 'osm'` (matched by name,
// not by an identifier shared with the timetable).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GENERIC, keyOf, tokens } from './lib-coords.mjs';
import { areaOf } from './lib-areas.mjs';

const R = 6371.0088;
const rad = Math.PI / 180;
function hav(a, b) {
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const has = (s) => s.lat !== undefined && s.lon !== undefined;
const PLACE_KM = 0.25; // stops this close count as one place (the two sides of a road)
const SHAPE_KM = 0.15; // a candidate must lie this close to the route polyline
const NEIGHBOUR_KM = 6;
// hand-checked positions (key as keyOf() writes it): the saddle Boca da Encumeada, not the tunnel the name search finds
const MANUAL = { encumeada: [32.7543, -17.0189] };
// only real settlements: the thousands of `locality` / `neighbourhood` nodes carry too many common words
const PLACE_TYPES = new Set(['city', 'town', 'village', 'suburb', 'hamlet']);
// "Estreito (ESCOLA)" is the school, not the village; these qualifiers still name the village's own stop
const VILLAGE_STOP = /^(partida|igreja|salao|bomba|centro)$/;
const villageName = (name) => [...name.matchAll(/\(([^)]*)\)/g)].every((m) => VILLAGE_STOP.test(keyOf(m[1])));
const MAX_NEIGHBOUR_KM = 20;

// Abbreviations printed in the timetables (key as keyOf() writes it) -> the name used on the map
const ALIASES = {
  'estreito c lobos': 'Estreito de Câmara de Lobos', 'estreito ca lobos': 'Estreito de Câmara de Lobos', 'estreito cª lobos': 'Estreito de Câmara de Lobos',
  'st cruz': 'Santa Cruz', 's cruz': 'Santa Cruz', 'p cruz': 'Porto da Cruz', 'porto cruz': 'Porto da Cruz', 'p delgada': 'Ponta Delgada',
  'ribeira janela': 'Ribeira da Janela', 'jardim mar': 'Jardim do Mar', 'paul mar': 'Paúl do Mar', 'madalena mar': 'Madalena do Mar',
  'faja ovelha': 'Fajã da Ovelha', 'arco calheta': 'Arco da Calheta', 'estreito calheta': 'Estreito da Calheta', 'ponta pargo': 'Ponta do Pargo',
  'jardim serra': 'Jardim da Serra', 'st serra': 'Santo da Serra', 's serra': 'Santo da Serra', 'rib machico': 'Ribeira de Machico',
  'baca d abra': "Baía d'Abra", 'baia d abra': "Baía d'Abra",
  'agua pena': 'Água de Pena', 'f penedo': 'Fajã do Penedo', 'faja penedo': 'Fajã do Penedo', 'ach castanheiro': 'Achada do Castanheiro',
};
/** Printed stop name -> cleaner name for matching: no "(Partida)" / "(Igreja)" qualifiers, no road suffix "ER 222", abbreviations resolved. */
export function canon(name) {
  const plain = name.replace(/\([^)]*\)/g, ' ').replace(/\bER\s*\d+/gi, ' ').replace(/\s+/g, ' ').trim();
  return ALIASES[keyOf(plain)] ?? plain;
}

/** OSM stops with a usable name, indexed by key and by token. */
export function buildOsmIndex(osm, places = []) {
  const stops = [];
  const placeIdx = new Map();
  for (const p of places) {
    const key = keyOf(p.name);
    if (key && PLACE_TYPES.has(p.place)) (placeIdx.get(key) ?? placeIdx.set(key, []).get(key)).push([p.lat, p.lon]);
  }
  for (const s of osm.stops) {
    for (const nm of [s.name, s.alt].filter(Boolean)) {
      const key = keyOf(nm);
      if (key) stops.push({ key, tok: new Set(tokens(key)), p: [s.lat, s.lon] });
    }
  }
  const exact = new Map();
  for (const e of stops) (exact.get(e.key) ?? exact.set(e.key, []).get(e.key)).push(e);
  return { stops, exact, placeIdx };
}

/** Closest name match: exact key, else the stops whose words include all of the name's words with the fewest extra words. */
function candidates(index, name) {
  const k = keyOf(canon(name));
  if (!k || GENERIC.has(k)) return [];
  const ex = index.exact.get(k);
  if (ex?.length) return ex.map((e) => e.p);
  const tk = tokens(k);
  if (!tk.length || tk.join('').length < 5) return [];
  let best = Infinity;
  let out = [];
  for (const e of index.stops) {
    if (!tk.every((w) => e.tok.has(w))) continue;
    const extra = e.key.split(' ').length - k.split(' ').length;
    if (extra < best) { best = extra; out = []; }
    if (extra === best) out.push(e.p);
  }
  // "CANIÇAL" is not the stop "Caniçal/Praínha/Baía d'Abra" 3 km away: more than one extra word is a different place
  return best <= 1 ? out : [];
}

/** Groups points that lie within PLACE_KM of each other. */
function clusters(pts) {
  const out = [];
  for (const p of pts) {
    const g = out.find((q) => q.pts.some((x) => hav(x, p) < PLACE_KM));
    if (g) g.pts.push(p);
    else out.push({ pts: [p] });
  }
  return out.map((g) => ({ p: [g.pts.reduce((a, x) => a + x[0], 0) / g.pts.length, g.pts.reduce((a, x) => a + x[1], 0) / g.pts.length], n: g.pts.length }));
}

const distToPolyline = (poly, p) => poly.reduce((d, v) => Math.min(d, hav(v, p)), Infinity); // shapes are dense enough for 150 m

/**
 * Fills stops without coordinates. Returns { filled, byHow: { unique, shape, neighbours, municipality }, missing }.
 * `areas` (prepared with prepareAreas) lets a line listed under one municipality prefer candidates inside it.
 */
export function applyOsm(lines, osm, areas, shapesDir, places = []) {
  const index = buildOsmIndex(osm, places);
  const r = { filled: 0, byHow: { unique: 0, shape: 0, neighbours: 0, municipality: 0, cluster: 0, place: 0, manual: 0 }, missing: 0 };
  const shapeCache = new Map();
  const shapeOf = (id) => {
    if (id == null) return null;
    if (!shapeCache.has(id)) {
      const f = path.join(shapesDir, `${id}.json`);
      shapeCache.set(id, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
    }
    return shapeCache.get(id);
  };
  const cache = new Map();
  for (const l of lines) {
    const muniOnly = l.municipality && !l.isInterurbano ? l.municipality : null;
    for (const d of l.directions) {
      const poly = shapeOf(d.shapeId);
      d.stops.forEach((s, i) => {
        if (has(s)) return;
        const manual = MANUAL[keyOf(canon(s.name))];
        if (manual) {
          Object.assign(s, { lat: manual[0], lon: manual[1], source: 'manual', locationPrecision: 'exact' });
          r.byHow.manual++;
          r.filled++;
          return;
        }
        let cand = cache.get(s.name);
        if (!cand) cache.set(s.name, (cand = clusters(candidates(index, s.name))));
        let how = '';
        let pick = null;
        if (!cand.length) {
          // no bus stop of that name: the village / hamlet of that name (a stop named after its village)
          const k = keyOf(canon(s.name));
          const pl = k && villageName(s.name) ? index.placeIdx.get(k) : null;
          if (pl?.length === 1) { pick = { p: pl[0] }; how = 'place'; }
          else { r.missing++; return; }
        }
        if (!pick && cand.length === 1) { pick = cand[0]; how = 'unique'; }
        if (!pick && poly) {
          const near = cand.filter((c) => distToPolyline(poly, c.p) < SHAPE_KM);
          if (near.length === 1) { pick = near[0]; how = 'shape'; }
        }
        if (!pick) {
          const refs = [];
          for (let j = i - 1; j >= 0; j--) if (has(d.stops[j])) { refs.push([d.stops[j].lat, d.stops[j].lon]); break; }
          for (let j = i + 1; j < d.stops.length; j++) if (has(d.stops[j])) { refs.push([d.stops[j].lat, d.stops[j].lon]); break; }
          if (refs.length) {
            const score = (c) => refs.reduce((t, x) => t + hav(c.p, x), 0) / refs.length;
            const ok = cand.filter((c) => score(c) < NEIGHBOUR_KM).sort((a, b) => score(a) - score(b));
            if (ok.length && (ok.length === 1 || score(ok[1]) > 3 * Math.max(score(ok[0]), 0.3))) { pick = ok[0]; how = 'neighbours'; }
          }
        }
        if (!pick && muniOnly && areas) {
          const inside = cand.filter((c) => areaOf(areas, c.p[0], c.p[1]).muni === muniOnly);
          if (inside.length === 1) { pick = inside[0]; how = 'municipality'; }
        }
        if (!pick && cand.length > 1) {
          // namesakes within 1 km of each other: the biggest cluster (both sides of the road) is the same spot for our purposes
          const sorted = [...cand].sort((a, b) => b.n - a.n);
          if (cand.every((c) => hav(c.p, sorted[0].p) < 1) && sorted[0].n > sorted[1].n) { pick = sorted[0]; how = 'cluster'; }
        }
        if (pick) {
          // sanity: a namesake on the other side of the island is not the stop (the neighbours of the direction are known)
          const near = [];
          for (let j = i - 1; j >= 0; j--) if (has(d.stops[j])) { near.push([d.stops[j].lat, d.stops[j].lon]); break; }
          for (let j = i + 1; j < d.stops.length; j++) if (has(d.stops[j])) { near.push([d.stops[j].lat, d.stops[j].lon]); break; }
          if (near.some((x) => hav(pick.p, x) > MAX_NEIGHBOUR_KM)) pick = null;
        }
        if (!pick) { r.missing++; return; }
        Object.assign(s, { lat: +pick.p[0].toFixed(6), lon: +pick.p[1].toFixed(6), approx: true, source: 'osm', locationPrecision: how === 'place' ? 'settlement_center' : 'exact' });
        r.byHow[how]++;
        r.filled++;
      });
    }
  }
  return r;
}

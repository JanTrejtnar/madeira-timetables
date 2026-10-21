// Searchable places for the planner's autocomplete: OpenStreetMap points of interest (data/osm/pois.json, `npm run fetch:pois`),
// the towns and villages of data/osm/places.json and a hand-made list of famous destinations (data/pois-curated.json).
// Output (public/data/pois.json): { places: [[name, kind, lat, lon, alt?]] } sorted by name, a few hundred KB at most.
const fold = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const metres = (a, b) => Math.hypot((a.lat - b.lat) * 110540, (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180));
const tokens = (name) => fold(name).split(' ').filter((t) => t.length >= 5);

/** kind of a town / village record of data/osm/places.json */
const settlementKind = (place) => (place === 'city' || place === 'town' ? 'town' : 'village');

export function buildPois(osmPois, osmPlaces, curated) {
  const out = [];
  for (const c of curated) out.push({ ...c, curated: true });
  const near = (p, list, r) => list.some((q) => metres(p, q) <= r);
  const cur = out.slice();
  for (const p of osmPois) {
    const t = tokens(p.name);
    // the curated entry of the same place (same kind, or a shared long word in the name) replaces the OSM point
    if (cur.some((c) => metres(p, c) <= 600 && (c.kind === p.kind || tokens(c.name).some((x) => t.includes(x))))) continue;
    out.push(p);
  }
  const seen = new Set(out.filter((p) => p.kind === 'town' || p.kind === 'village').map((p) => fold(p.name)));
  for (const p of osmPlaces) {
    if (!p.name || seen.has(fold(p.name))) continue;
    if (!['city', 'town', 'village', 'suburb', 'hamlet'].includes(p.place)) continue;
    out.push({ name: p.name, kind: settlementKind(p.place), lat: p.lat, lon: p.lon });
    seen.add(fold(p.name));
  }
  // the same name and kind within a kilometre is one place (a beach mapped in two pieces)
  const kept = [];
  for (const p of out) if (!kept.some((q) => q.kind === p.kind && fold(q.name) === fold(p.name) && metres(p, q) < 1000)) kept.push(p);
  out.length = 0;
  out.push(...kept);
  out.sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  return out.map((p) => [p.name, p.kind, +p.lat.toFixed(5), +p.lon.toFixed(5), ...(p.alt?.length ? [p.alt] : [])]);
}

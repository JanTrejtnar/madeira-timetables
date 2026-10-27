// Fills coordinates of stops that are only known by name (SAM sheets, manual transcriptions, "Transbordo" tables)
// from stops of other routes that have coordinates (shapedata). Matches are marked `approx: true`.
const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** stop name without the direction marker ("…, D", "…, S2A", "T-49") */
export const keyOf = (name) => norm(name).replace(/ (d|s)\d*[a-z]?$/, '').replace(/ t \d+$/, '');
// words that carry no identity ("ESTR Lombo Chão" = the junction at Lombo Chão)
const NOISE = new Set(['estr', 'cam', 'caminho', 'estrada', 'rua', 'de', 'da', 'do', 'dos', 'das', 'e', 'a', 'o', 'ee', 'escola', 'esc', 'ant', 'antes', 'apos', 'junto', 'via']);
export const tokens = (k) => k.split(' ').filter((w) => w.length > 1 && !NOISE.has(w) && !/^\d+$/.test(w));
// names that denote a whole town: too many stops carry them to place one by name
// positional qualifiers: "Terra Chã Cima" (upper) is printed, the stop list only has "Terra Chã-Ponte"
const QUALIFIERS = new Set(['cima', 'baixo', 'alto', 'fundo', 'norte', 'sul']);
export const GENERIC = new Set(['funchal', 'centro', 'machico', 'santa cruz', 'st cruz', 'calheta', 'camacha', 'canico', 'porto moniz', 'ribeira brava', 'camara de lobos', 'ponta do sol', 'santana', 'sao vicente']);

/** a namesake of an official stop this close is the same boarding place */
const SAME_SPOT_KM = 0.25;
const R = 6371.0088;
const rad = Math.PI / 180;
function hav(a, b) {
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const centroid = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
const has = (s) => s.lat !== undefined && s.lon !== undefined;

/** Index of every stop with coordinates, by normalised name and by tokens. */
export function buildStopIndex(lines) {
  const exact = new Map();
  const all = [];
  for (const l of lines) {
    for (const d of l.directions) {
      for (const s of d.stops) {
        // hand-placed overrides are valid for the lines they name only: a namesake elsewhere (Moinhos of line 505) must not borrow them
        if (!has(s) || s.approx || s.source === 'override') continue;
        const k = keyOf(s.name);
        if (!k) continue;
        const e = { key: k, tok: new Set(tokens(k)), p: [s.lat, s.lon] };
        (exact.get(k) ?? exact.set(k, []).get(k)).push(e);
        all.push(e);
      }
    }
  }
  return { exact, all };
}

/** Candidate points for a stop name: exact normalised match, else every stop whose words include all the name's words. */
function candidates(index, name) {
  const k = keyOf(name);
  if (!k) return { pts: [], how: 'none' };
  if (GENERIC.has(k)) return { pts: [], how: 'generic' };
  const ex = index.exact.get(k);
  if (ex?.length) return { pts: ex.map((e) => e.p), how: 'exact' };
  const tk = tokens(k);
  if (!tk.length || tk.join('').length < 5) return { pts: [], how: 'short' };
  const pts = index.all.filter((e) => tk.every((w) => e.tok.has(w))).map((e) => e.p);
  if (pts.length) return { pts, how: 'tokens' };
  const core = tk.filter((w) => !QUALIFIERS.has(w));
  if (core.length && core.length < tk.length && core.join('').length >= 5) {
    return { pts: index.all.filter((e) => core.every((w) => e.tok.has(w))).map((e) => e.p), how: 'core' };
  }
  return { pts, how: 'tokens' };
}

/**
 * Adds lat/lon (approx: true) to stops without coordinates. Candidates that lie within 400 m of each other count as one
 * place; several places are resolved by the distance to the coordinates the same line already has (≤ 5 km), else skipped.
 * Returns { filled, missing } counts.
 */
export function fillCoords(lines, index) {
  let filled = 0;
  let missing = 0;
  const near = (pts, refs, maxKm) => {
    const score = (p) => refs.reduce((t, r) => t + hav(p, r), 0) / refs.length;
    const ok = pts.filter((p) => score(p) < maxKm).sort((x, y) => score(x) - score(y));
    return ok.length && ok.every((p) => hav(p, ok[0]) < 0.4) ? centroid(ok) : null;
  };
  // closest candidate to the neighbouring stops when the candidates are spread over at most `spread` km
  const nearest = (pts, refs, maxKm, spread) => {
    const score = (p) => refs.reduce((t, r) => t + hav(p, r), 0) / refs.length;
    const ok = pts.filter((p) => score(p) < maxKm).sort((x, y) => score(x) - score(y));
    if (!ok.length) return null;
    // the namesake right next to the neighbouring stops wins if every other namesake is clearly farther away
    const rest = ok.filter((p) => hav(p, ok[0]) >= spread);
    return rest.every((p) => score(p) > 3 * Math.max(score(ok[0]), 0.3)) ? ok[0] : null;
  };
  // a terminal named like a terminal of the same line's main directions gets that terminal's coordinates
  for (const l of lines) {
    const term = new Map();
    for (const d of l.directions) {
      if (d.variant === 'transbordo' || !d.stops.length) continue;
      if (d.from && has(d.stops[0])) term.set(keyOf(d.from), [d.stops[0].lat, d.stops[0].lon]);
      if (d.to && has(d.stops.at(-1))) term.set(keyOf(d.to), [d.stops.at(-1).lat, d.stops.at(-1).lon]);
    }
    for (const d of l.directions) {
      for (const s of d.stops) {
        const p = !has(s) ? term.get(keyOf(s.name)) : null;
        if (p) Object.assign(s, { lat: p[0], lon: p[1], approx: true });
      }
    }
  }
  // two passes: places found in the first one give context (neighbouring stops) to the second
  for (let pass = 0; pass < 2; pass++) {
    filled = 0;
    missing = 0;
    for (const l of lines) {
      for (const d of l.directions) {
        d.stops.forEach((s, i) => {
          if (has(s)) return;
          const { pts, how } = candidates(index, s.name);
          let place = null;
          if (pts.length) {
            const c = centroid(pts);
            if (pts.every((p) => hav(p, c) < 0.4)) place = c;
            else {
              // nearest stops of the same direction that have coordinates, before and after this one
              const refs = [];
              for (let j = i - 1; j >= 0; j--) if (has(d.stops[j])) { refs.push([d.stops[j].lat, d.stops[j].lon]); break; }
              for (let j = i + 1; j < d.stops.length; j++) if (has(d.stops[j])) { refs.push([d.stops[j].lat, d.stops[j].lon]); break; }
              if (refs.length) place = near(pts, refs, 6) ?? (how === 'core' ? nearest(pts, refs, 6, 1.5) : null);
            }
          }
          if (place) {
            s.lat = +place[0].toFixed(6);
            s.lon = +place[1].toFixed(6);
            // the same name as a stop with an official position, every such stop within SAME_SPOT_KM: the same boarding place, not a guess
            if (how === 'exact' && pts.every((p) => hav(p, place) < SAME_SPOT_KM)) s.locationPrecision = 'exact';
            else s.approx = true;
            filled++;
          } else missing++;
        });
      }
    }
  }
  filled = lines.reduce((n, l) => n + l.directions.reduce((m, d) => m + d.stops.filter((s) => s.approx || s.locationPrecision === 'exact').length, 0), 0);
  return { filled, missing };
}

/**
 * Last step before the precision labels: a stop with only an estimated position (name_match, settlement centre, interpolated,
 * corridor match) that has an official namesake within SAME_SPOT_KM takes that stop's position and precision. Hand-placed
 * overrides keep theirs. Returns the stops moved.
 */
export function inheritSameSpot(lines) {
  const official = new Map();
  const isOfficial = (s) => has(s) && !s.via && (s.locationPrecision === 'exact' || (!s.locationPrecision && !s.approx && !s.isEstimatedLocation));
  for (const l of lines) for (const d of l.directions) for (const s of d.stops) if (isOfficial(s)) (official.get(keyOf(s.name)) ?? official.set(keyOf(s.name), []).get(keyOf(s.name))).push([s.lat, s.lon]);
  let moved = 0;
  for (const l of lines) {
    for (const d of l.directions) {
      for (const s of d.stops) {
        if (!has(s) || s.via || isOfficial(s) || s.source === 'override' || s.locationPrecision === 'manual_osm_match') continue;
        const near = (official.get(keyOf(s.name)) ?? []).filter((p) => hav(p, [s.lat, s.lon]) < SAME_SPOT_KM);
        if (!near.length || !near.every((p) => hav(p, near[0]) < SAME_SPOT_KM)) continue;
        near.sort((a, b) => hav(a, [s.lat, s.lon]) - hav(b, [s.lat, s.lon]));
        for (const f of ['approx', 'isEstimatedLocation', 'source']) delete s[f];
        Object.assign(s, { lat: near[0][0], lon: near[0][1], locationPrecision: 'exact' });
        moved++;
      }
    }
  }
  return moved;
}

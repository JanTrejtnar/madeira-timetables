// "Via X" notes of a timetable ("a" = "Via Aeroporto") name a place the bus really calls at on those trips only. This step
// resolves X to a position and finds where in each direction the stop belongs (between which two stops of the list).
// The app then inserts it for the trips that carry the note. Not a stop: "Via Rápida" / "VR" (motorway), which stays a label.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { keyOf, tokens } from './lib-coords.mjs';
import { buildOsmIndex, namedPlaces } from './lib-osm.mjs';
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
const MAX_DETOUR_KM = 1.5; // the place must lie this close to the straight way between its neighbouring stops
const MAX_DETOUR_MANUAL_KM = 3; // hand-placed positions are place centres, not stops: more slack
const SAME_STOP_KM = 0.2; // closer than this to a listed stop: the stop is already in the list

/**
 * Place names of a "Via X" note: one per segment, split at commas and "e" ("Via Ilha e St. António", "Via Cº Chão, Silveira,
 * A. Marques e Ilha"). null for anything that is not a plain list of places ("Via Rápida", street lists, school-day rules).
 * Only a sentence that starts with "Via" counts ("Até Lº Galego. Via Ach. C. Gordo" -> Ach. C. Gordo).
 */
export function viaNames(text) {
  const m = /(?:^|\.\s+)via\s+(.+)$/i.exec(text.normalize('NFC').trim());
  if (!m) return null;
  const rest = m[1].trim().replace(/\.$/, '');
  if (/[/();:0-9]/.test(rest) || /[a-zà-ÿ]{5,}\.\s/i.test(rest)) return null; // a longer sentence follows
  if (/r[aá]pida|expresso|escola|zona industrial/i.test(rest)) return null;
  const names = rest.split(/,|\s+e\s+/i).map((x) => x.trim()).filter(Boolean);
  return names.length && names.every((n) => n.length >= 3 && n.length <= 40) ? names : null;
}

/**
 * Where along the route polyline of a direction each positioned stop lies (index of the nearest point, never going back), so a place
 * can be assigned to the stretch of road it is nearest to; straight lines between two stops cannot tell which side of a loop it is on.
 */
function alongRoute(d, shapesDir) {
  const f = shapesDir && d.shapeId != null ? path.join(shapesDir, `${d.shapeId}.json`) : null;
  if (!f || !existsSync(f)) return null;
  const poly = JSON.parse(readFileSync(f, 'utf8'));
  const nearest = (p, from = 0) => {
    let best = from;
    let bd = Infinity;
    for (let i = from; i < poly.length; i++) {
      const d2 = (poly[i][0] - p[0]) ** 2 + ((poly[i][1] - p[1]) * 0.84) ** 2;
      if (d2 < bd) { bd = d2; best = i; }
    }
    return best;
  };
  let at = 0;
  const stopAt = d.stops.map((s) => (has(s) ? (at = nearest([s.lat, s.lon], at)) : null));
  return { nearest, stopAt };
}

/** Every note text a line can carry on a trip: the legend codes and the free-text notes of hand-made transcriptions. */
function noteKeys(l) {
  const keys = new Map(Object.entries(l.notes ?? {}));
  for (const d of l.directions) {
    const lists = [...(d.trips ?? []).map((t) => t.notes), ...Object.values(d.departures).flat().map((x) => x.notes)];
    for (const n of lists.flat()) if (n && !keys.has(n) && /\bvia\b/i.test(n)) keys.set(n, n);
  }
  return keys;
}

/**
 * Sets `line.via[note] = [{ name, lat, lon, source, after: { dirIndex: stopIndex }, muni?, par? }, ...]` (in the printed order of the note)
 * for every resolvable place of a "Via X" note; `note` = legend code or, for free-text notes, the text itself. Returns the number of places.
 * `areas` (optional) adds the parish and municipality of each place so the planner groups it with the stops of its parish.
 */
export function addViaPlaces(lines, osm, osmPlaces, manual, report = null, areas = null, shapesDir = null) {
  const index = buildOsmIndex(osm, osmPlaces);
  let n = 0;
  for (const l of lines) {
    for (const [code, text] of noteKeys(l)) {
      const names = viaNames(text);
      if (!names) {
        if (report && /\bvia\b/i.test(text)) report.push({ line: l.number, code, text, status: /r[aá]pida|expresso/i.test(text) ? 'corridor' : 'not-a-place' });
        continue;
      }
      const found = [];
      for (const name of names) {
        const key = keyOf(name);
        const mans = [].concat(manual.places?.[key] ?? []);
        const cands = mans.length ? mans.map((m) => ({ p: [m.lat, m.lon], how: 'manual', max: m.maxDetourKm ?? MAX_DETOUR_MANUAL_KM, muni: m.muni })) : namedPlaces(index, name).map((c) => ({ ...c, max: MAX_DETOUR_KM }));
        if (!cands.length) {
          report?.push({ line: l.number, code, text, name, status: 'no-position' });
          continue;
        }
        const after = {};
        let best = null;
        let alreadyStop = false;
        let routed = false; // some direction that uses the note lists at least two stops with a position
        l.directions.forEach((d, di) => {
          const route = alongRoute(d, shapesDir);
          const used = d.trips?.some((t) => t.notes?.includes(code)) || Object.values(d.departures).some((list) => list.some((x) => x.notes?.includes(code)));
          if (!used) return;
          // the place is already a stop of this direction
          const tk = tokens(key);
          if (d.stops.some((s) => tk.length && tk.every((w) => tokens(keyOf(s.name)).includes(w)))) { alreadyStop = true; return; }
          const pos = d.stops.map((s, i) => ({ s, i })).filter((x) => has(x.s));
          if (pos.length >= 2) routed = true;
          let pick = null;
          const fits = new Map(); // namesakes that lie on the way -> their best stretch; more than one place = ambiguous ("Centro Saúde"), not inserted
          for (const c of cands) {
            if (pos.some((x) => hav([x.s.lat, x.s.lon], c.p) < SAME_STOP_KM)) { fits.clear(); alreadyStop = true; break; }
            // with a route polyline the stretch is the one of the road the place is nearest to
            const hit = route ? route.nearest(c.p) : null;
            for (let k = 0; k + 1 < pos.length; k++) {
              if (hit !== null && !(route.stopAt[pos[k].i] <= hit && (hit <= route.stopAt[pos[k + 1].i] || k + 2 === pos.length))) continue;
              const a = [pos[k].s.lat, pos[k].s.lon];
              const b = [pos[k + 1].s.lat, pos[k + 1].s.lon];
              const detour = hav(a, c.p) + hav(c.p, b) - hav(a, b);
              if (detour <= c.max && (!fits.has(c) || detour < fits.get(c).detour)) fits.set(c, { c, detour, idx: pos[k].i });
            }
          }
          // namesakes in several municipalities (Silveira): the one in the line's own municipality
          const own = [...fits.keys()].filter((c) => c.muni && c.muni === l.municipality);
          if (fits.size === 1) pick = [...fits.values()][0];
          else if (own.length === 1) pick = fits.get(own[0]);
          if (!pick) return;
          after[di] = pick.idx;
          best = pick.c;
        });
        if (!best) {
          report?.push({ line: l.number, code, text, name, status: alreadyStop ? 'already-a-stop' : !routed ? 'no-stop-list' : 'off-route' });
          continue;
        }
        const man = mans.find((m) => m.lat === best.p[0] && m.lon === best.p[1]);
        const lat = +best.p[0].toFixed(6);
        const lon = +best.p[1].toFixed(6);
        const area = areas ? areaOf(areas, lat, lon) : null;
        report?.push({ line: l.number, code, text, name, status: 'resolved', how: best.how, ...(area?.parish ? { par: area.parish } : {}) });
        found.push({ name: man?.name ?? name, lat, lon, source: best.how === 'manual' ? 'manual' : 'osm', after, ...(area?.muni ? { muni: area.muni } : {}), ...(area?.parish ? { par: area.parish } : {}) });
        n++;
      }
      if (found.length) (l.via ??= {})[code] = found;
    }
  }
  return n;
}

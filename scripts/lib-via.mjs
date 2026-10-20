// "Via X" notes of a timetable ("a" = "Via Aeroporto") name a place the bus really calls at on those trips only. This step
// resolves X to a position and finds where in each direction the stop belongs (between which two stops of the list).
// The app then inserts it for the trips that carry the note. Not a stop: "Via Rápida" / "VR" (motorway), which stays a label.
import { keyOf, tokens } from './lib-coords.mjs';
import { buildOsmIndex, namedPlaces } from './lib-osm.mjs';

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

/** Place name of a "Via X" note, null for anything that is not a plain place ("Via Rápida", street lists, school-day rules). */
export function viaName(text) {
  const m = /^\s*via\s+([^/(),.;:0-9]{3,40}?)\s*$/i.exec(text.normalize('NFC'));
  if (!m) return null;
  const name = m[1].trim();
  if (/r[aá]pida|expresso|escola|zona industrial/i.test(name)) return null;
  return name;
}

/** Sets `line.via[code] = { name, lat, lon, source, after: { dirIndex: stopIndex } }` for every resolvable "Via X" note; returns the count. */
export function addViaPlaces(lines, osm, osmPlaces, manual, report = null) {
  const index = buildOsmIndex(osm, osmPlaces);
  let n = 0;
  for (const l of lines) {
    for (const [code, text] of Object.entries(l.notes ?? {})) {
      const name = viaName(text);
      if (!name) {
        if (report && /\bvia\b/i.test(text)) report.push({ line: l.number, code, text, status: /r[aá]pida|expresso/i.test(text) ? 'corridor' : 'not-a-place' });
        continue;
      }
      const key = keyOf(name);
      const mans = [].concat(manual.places?.[key] ?? []);
      const man = mans[0];
      const cands = mans.length ? mans.map((m) => ({ p: [m.lat, m.lon], how: 'manual' })) : namedPlaces(index, name);
      if (!cands.length) {
        report?.push({ line: l.number, code, text, name, status: 'no-position' });
        continue;
      }
      const after = {};
      let best = null;
      let alreadyStop = false;
      let routed = false; // some direction that uses the note lists at least two stops with a position
      l.directions.forEach((d, di) => {
        const used = d.trips?.some((t) => t.notes?.includes(code)) || Object.values(d.departures).some((list) => list.some((x) => x.notes?.includes(code)));
        if (!used) return;
        // the place is already a stop of this direction
        const tk = tokens(key);
        if (d.stops.some((s) => tk.length && tk.every((w) => tokens(keyOf(s.name)).includes(w)))) { alreadyStop = true; return; }
        const pos = d.stops.map((s, i) => ({ s, i })).filter((x) => has(x.s));
        if (pos.length >= 2) routed = true;
        let pick = null;
        const fits = new Set(); // namesakes that lie on the way: more than one place = ambiguous ("Centro Saúde"), not inserted
        for (const c of cands) {
          if (pos.some((x) => hav([x.s.lat, x.s.lon], c.p) < SAME_STOP_KM)) { pick = null; alreadyStop = true; break; }
          for (let k = 0; k + 1 < pos.length; k++) {
            const a = [pos[k].s.lat, pos[k].s.lon];
            const b = [pos[k + 1].s.lat, pos[k + 1].s.lon];
            const detour = hav(a, c.p) + hav(c.p, b) - hav(a, b);
            const max = c.how === 'manual' ? MAX_DETOUR_MANUAL_KM : MAX_DETOUR_KM;
            if (detour <= max) fits.add(c);
            if (detour <= max && (!pick || detour < pick.detour)) pick = { c, detour, idx: pos[k].i };
          }
        }
        if (!pick || fits.size > 1) return;
        after[di] = pick.idx;
        best = pick.c;
      });
      if (!best) {
        report?.push({ line: l.number, code, text, name, status: alreadyStop ? 'already-a-stop' : !routed ? 'no-stop-list' : 'off-route' });
        continue;
      }
      report?.push({ line: l.number, code, text, name, status: 'resolved', how: best.how });
      (l.via ??= {})[code] = { name: man?.name ?? name, lat: +best.p[0].toFixed(6), lon: +best.p[1].toFixed(6), source: best.how === 'manual' ? 'manual' : 'osm', after };
      n++;
    }
  }
  return n;
}

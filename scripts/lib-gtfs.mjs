// Official stop coordinates from the Horários do Funchal GTFS feed (data/gtfs/stops.json, see fetch-gtfs.mjs) and the
// municipality (concelho) of every stop, used for the "all stops of <town>" search.
import { areaOf } from './lib-areas.mjs';

const R = 6371.0088;
const rad = Math.PI / 180;
function hav(a, b) {
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const SIDE = /\s+(d|s|t)\s*\d*[a-z]?$|\s+t\s*\d+$/;
const words = (name) => new Set(norm(name).replace(SIDE, '').split(' ').filter((w) => w.length >= 4 && !/^\d+$/.test(w)));
const has = (s) => s.lat !== undefined && s.lon !== undefined;

/** Stops of the feed as a pseudo line, so the name index of fillCoords can use them too. */
export const gtfsAsLine = (gtfs) => ({ directions: [{ stops: gtfs.stops.map((s) => ({ name: s.name, lat: s.lat, lon: s.lon })) }] });

/**
 * Stops whose `code` is a feed stop code get the official position. A stop that already has one keeps the SIGA position
 * unless the feed's differs by under 150 m (then the operator's wins); one without needs a similar name or a position
 * within 4 km of its neighbours in the direction, as codes of the two systems are not guaranteed to be shared.
 */
export function applyGtfs(lines, gtfs) {
  const byCode = new Map();
  for (const s of gtfs.stops) (byCode.get(s.code) ?? byCode.set(s.code, []).get(s.code)).push(s);
  const r = { filled: 0, overridden: 0, same: 0, conflicts: 0, rejected: 0 };
  for (const l of lines) {
    for (const d of l.directions) {
      d.stops.forEach((s, i) => {
        const cand = s.code ? byCode.get(String(s.code)) : null;
        if (!cand?.length) return;
        if (has(s)) {
          const best = cand.map((c) => ({ c, km: hav([s.lat, s.lon], [c.lat, c.lon]) })).sort((a, b) => a.km - b.km)[0];
          if (best.km < 0.001) r.same++;
          else if (best.km < 0.15 || s.approx) {
            Object.assign(s, { lat: best.c.lat, lon: best.c.lon });
            delete s.approx;
            r.overridden++;
          } else r.conflicts++;
          return;
        }
        const w = words(s.name);
        const best = cand.find((c) => [...words(c.name)].some((x) => w.has(x))) ?? null;
        let ok = !!best;
        if (!ok && cand.length === 1) {
          const nb = [d.stops[i - 1], d.stops[i + 1]].filter((x) => x && has(x));
          ok = nb.length > 0 && nb.every((x) => hav([x.lat, x.lon], [cand[0].lat, cand[0].lon]) < 4);
        }
        if (!ok) { r.rejected++; return; }
        const c = best ?? cand[0];
        Object.assign(s, { lat: c.lat, lon: c.lon, source: 'gtfs' });
        delete s.approx;
        r.filled++;
      });
    }
  }
  return r;
}

// Reference points (parish seats and towns) per municipality; the feed labels its own stops (Funchal area, Câmara de Lobos,
// Ribeira Brava) which adds thousands of points there. A stop belongs to the municipality of the nearest reference point.
const MUNI_NAMES = new Set(['Funchal', 'Câmara de Lobos', 'Ribeira Brava', 'Ponta do Sol', 'Calheta', 'Porto Moniz', 'São Vicente', 'Santana', 'Machico', 'Santa Cruz', 'Porto Santo']);
const SEEDS = {
  Funchal: [[32.6496, -16.9086], [32.6667, -16.8983], [32.6700, -16.9300], [32.6460, -16.9250], [32.6490, -16.8740]],
  'Câmara de Lobos': [[32.6490, -16.9770], [32.6595, -17.0000], [32.7178, -16.9695], [32.6847, -17.0000], [32.6600, -17.0000]],
  'Ribeira Brava': [[32.6733, -17.0613], [32.7167, -17.0500], [32.6667, -17.0333]],
  'Ponta do Sol': [[32.6783, -17.1011], [32.6803, -17.1370]],
  Calheta: [[32.7228, -17.1747], [32.7048, -17.1607], [32.7531, -17.2239], [32.7480, -17.2060], [32.7600, -17.1950], [32.8000, -17.2250]],
  'Porto Moniz': [[32.8667, -17.1667], [32.8250, -17.1131]],
  'São Vicente': [[32.7967, -17.0460], [32.8156, -16.9831], [32.8239, -16.9919]],
  Santana: [[32.8000, -16.8833], [32.7833, -16.8500]],
  Machico: [[32.7167, -16.7667], [32.7700, -16.8250], [32.7367, -16.7358]],
  'Santa Cruz': [[32.6872, -16.7931], [32.6439, -16.8381], [32.6700, -16.8570], [32.6783, -16.8467], [32.7100, -16.8000], [32.6940, -16.7740]],
  'Porto Santo': [[33.0700, -16.3400]],
};
// localities (freguesias) that stops without coordinates are named after; only unambiguous names
const LOCALITIES = [
  ['Funchal', ['monte', 'sao roque', 'sao goncalo', 'santo antonio', 'santa luzia', 'sao martinho', 'sao pedro', 'poiso', 'terreiro da luta']],
  ['Câmara de Lobos', ['estreito de camara de lobos', 'estreito c lobos', 'curral das freiras', 'jardim da serra', 'quinta grande']],
  ['Ribeira Brava', ['campanario', 'serra de agua', 'tabua']],
  ['Ponta do Sol', ['madalena do mar', 'canhas']],
  ['Calheta', ['arco da calheta', 'estreito da calheta', 'faja da ovelha', 'jardim do mar', 'paul do mar', 'ponta do pargo', 'prazeres']],
  ['Porto Moniz', ['achadas da cruz', 'ribeira da janela', 'seixal']],
  ['São Vicente', ['boaventura', 'ponta delgada']],
  ['Santana', ['faial', 'ribeiro frio', 'arco sao jorge', 'sao jorge', 'cruzinhas']],
  ['Machico', ['agua de pena', 'canical', 'porto da cruz', 'porto cruz']],
  ['Santa Cruz', ['camacha', 'canico', 'gaula', 'santo da serra', 'santo antonio da serra', 's serra', 'aeroporto']],
];
// the town named in a stop name places stops that have no coordinates
const TOWN_NAMES = [['Funchal', 'funchal'], ['Câmara de Lobos', 'camara de lobos'], ['Ribeira Brava', 'ribeira brava'], ['Ponta do Sol', 'ponta do sol'], ['Calheta', 'calheta'], ['Porto Moniz', 'porto moniz'], ['São Vicente', 'sao vicente'], ['Santana', 'santana'], ['Machico', 'machico'], ['Santa Cruz', 'santa cruz'], ['Porto Santo', 'porto santo']];

/**
 * Sets `muni` (concelho) and, with the OSM boundaries in `areas`, `par` (freguesia) on every stop. A stop with coordinates
 * takes them from the polygon it lies in; without OSM boundaries the nearest reference point decides. Stops without
 * coordinates are placed by a parish / town named in the stop name, then by the neighbouring stops of the direction.
 * Returns { byPosition, byName, byContext, none }.
 */
export function assignMunicipalities(lines, gtfs, areas = null) {
  const refs = [];
  for (const [m, pts] of Object.entries(SEEDS)) for (const p of pts) refs.push({ m, p });
  for (const s of gtfs.stops) if (s.muni) refs.push({ m: s.muni, p: [s.lat, s.lon] });
  const r = { byPosition: 0, byName: 0, byContext: 0, none: 0 };
  // parishes whose name identifies them in a stop name (longest first so "Santo António da Serra" beats "Santo António")
  const uniq = (areas?.parishes ?? []).filter((p) => p.label === p.name && p.muni && norm(p.name).length >= 5);
  const parishNames = uniq.map((p) => [norm(p.name), p]).sort((a, b) => b[0].length - a[0].length);
  for (const l of lines) {
    for (const d of l.directions) {
      for (const s of d.stops) {
        if (has(s) && areas) {
          const a = areaOf(areas, s.lat, s.lon);
          if (a.muni) {
            s.muni = a.muni;
            if (a.parish) s.par = a.parish;
            r.byPosition++;
            continue;
          }
        }
        if (has(s)) {
          let best = refs[0];
          let bd = Infinity;
          for (const x of refs) {
            const dx = (x.p[0] - s.lat) * 111;
            const dy = (x.p[1] - s.lon) * 93;
            const dd = dx * dx + dy * dy;
            if (dd < bd) { bd = dd; best = x; }
          }
          s.muni = best.m;
          r.byPosition++;
          continue;
        }
        const n = norm(s.name);
        const pa = parishNames.find(([k]) => new RegExp(`(^| )${k}( |$)`).test(n));
        if (pa) { s.par = pa[1].label; s.muni = pa[1].muni ?? s.muni; if (s.muni) { r.byName++; continue; } }
        const t = TOWN_NAMES.find(([, k]) => new RegExp(`(^| )${k}( |$)`).test(n)) ?? LOCALITIES.flatMap(([m, ks]) => ks.filter((k) => new RegExp(`(^| )${k}( |$)`).test(n)).map((k) => [m, k])).sort((a, b) => b[1].length - a[1].length)[0];
        if (t) { s.muni = t[0]; r.byName++; }
      }
    }
  }
  // still unplaced: a run between two stops of the same municipality belongs to it; a run at the end of the direction
  // (after the last placed stop) goes to the municipality the line is listed under
  for (const l of lines) {
    for (const d of l.directions) {
      const st = d.stops;
      for (let i = 0; i < st.length; i++) {
        if (st[i].muni) continue;
        let j = i;
        while (j < st.length && !st[j].muni) j++;
        const before = st[i - 1]?.muni;
        const after = st[j]?.muni;
        const m = before && after ? (before === after ? before : null) : j >= st.length && l.municipality && MUNI_NAMES.has(l.municipality) ? l.municipality : null;
        if (m) for (let k = i; k < j; k++) { st[k].muni = m; r.byContext++; }
        i = j;
      }
    }
  }
  for (const l of lines) {
    for (const d of l.directions) {
      const st = d.stops;
      for (let i = 0; i < st.length; i++) {
        if (st[i].par) continue;
        let j = i;
        while (j < st.length && !st[j].par) j++;
        const before = st[i - 1]?.par;
        // only stops of the same municipality inherit the parish between two stops of one parish
        if (before && before === st[j]?.par) for (let k = i; k < j; k++) if (!st[k].muni || st[k].muni === st[j].muni) { st[k].par = before; st[k].muni = st[j].muni; }
        i = j;
      }
    }
  }
  for (const l of lines) for (const d of l.directions) for (const s of d.stops) if (!s.muni) r.none++;
  return r;
}

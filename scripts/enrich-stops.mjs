// Fills in the intermediate stops of lines whose timetable prints only the two terminals. The stop sequences come from the journey
// planner behind the SIGA website (OpenTripPlanner, GTFS GraphQL API; the same source the open-source Madeira-by-buses project uses
// for CAM and SIGA Rodoeste): every pattern of every route with its stops, coordinates and the median running time to each stop.
// Output: data/siga-patterns.json (committed); build:data matches the patterns to the terminal-only directions (lib-enrich.mjs).
// Horários do Funchal (agency 1:HF) has a GTFS feed of its own (data/gtfs) and is left out.
// Usage: node scripts/enrich-stops.mjs     (`npm run enrich:stops`, then `npm run build:data`)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.SIGA_OTP_URL ?? 'https://sigadev.imt.madeira.gov.pt/otp/otp/gtfs/v1';
const BATCH = 40;
const SKIP_AGENCY = /^HF$|Hor[aá]rios do Funchal/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'madeira-timetables (offline PWA; build-time stop fetch)' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.errors?.length) throw new Error(JSON.stringify(j.errors).slice(0, 300));
      return j.data;
    } catch (err) {
      if (attempt >= 3) throw new Error(`SIGA journey planner: ${err.message}`, { cause: err });
      await sleep(3000 * attempt);
    }
  }
}

const ROUTES = `query($ids: [String]) {
  routes(ids: $ids) {
    gtfsId shortName longName agency { name }
    patterns { code headsign stops { gtfsId code name lat lon } trips { gtfsId stoptimes { scheduledDeparture stop { gtfsId code } } } }
  }
}`;
/** "CZ Faja das Galinhas (12934)" -> "CZ Faja das Galinhas". */
const clean = (name) => String(name).replace(/\s*\(\d+\)\s*$/, '').replace(/\s+/g, ' ').trim();
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

const all = (await gql('{ routes { gtfsId agency { name } } }')).routes.filter((r) => !SKIP_AGENCY.test(r.agency?.name ?? ''));
console.log('SIGA planner:', all.length, 'routes of CAM / Rodoeste');
const lines = {};
/** code -> [name, lat, lon]; patterns list codes only */
const stops = {};
let patterns = 0;
/** raw GraphQL answer of every route, kept in the repository in case the planner goes down */
const dump = [];
for (let i = 0; i < all.length; i += BATCH) {
  const { routes } = await gql(ROUTES, { ids: all.slice(i, i + BATCH).map((r) => r.gtfsId) });
  dump.push(...routes);
  for (const r of routes) {
    for (const p of r.patterns ?? []) {
      if (p.stops.length < 2 || !p.trips?.length) continue;
      // minutes from the first stop, per trip; the median over the trips is the running time (a trip skipping a stop is left out)
      const rows = p.trips.map((t) => t.stoptimes).filter((st) => st.length === p.stops.length);
      if (!rows.length) continue;
      const offsets = p.stops.map((_, k) => Math.round(median(rows.map((st) => (st[k].scheduledDeparture - st[0].scheduledDeparture) / 60))));
      (lines[r.shortName] ??= []).push({
        route: r.longName,
        headsign: p.headsign ?? null,
        trips: p.trips.length,
        stops: p.stops.map((s) => {
          stops[s.code] ??= [clean(s.name), +s.lat.toFixed(6), +s.lon.toFixed(6)];
          return s.code;
        }),
        offsets,
      });
      patterns++;
    }
  }
  await sleep(500);
}
mkdirSync(path.join(ROOT, 'data', 'sources', 'siga'), { recursive: true });
writeFileSync(path.join(ROOT, 'data', 'sources', 'siga', 'siga-otp-dump.json'), JSON.stringify({ source: API, fetched: new Date().toISOString(), routes: dump }) + '\n');
for (const list of Object.values(lines)) list.sort((a, b) => b.trips - a.trips);
writeFileSync(path.join(ROOT, 'data', 'siga-patterns.json'), JSON.stringify({ source: 'SIGA journey planner (OpenTripPlanner), ' + API, stops, lines }) + '\n');
console.log('data/siga-patterns.json:', Object.keys(lines).length, 'lines,', patterns, 'patterns');

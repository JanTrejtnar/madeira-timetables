// The planner's search off the page's thread (RAPTOR over a day of trips takes about a second on a desktop, several on a phone: the page froze).
// The page sends the timetable once (`init`), then one `search` per question; see searchClient.ts.
import { buildNetwork, servicesFor, type Network, type Trip } from './network';
import { runSearch } from './plannerSearch';
import type { SearchJob, WorkerRequest, WorkerReply } from './searchClient';
import { toWire } from './searchWire';

let net: Network | null = null;
let lines: import('../types').Line[] = [];
const days = new Map<string, Trip[]>();

const post = (m: WorkerReply) => (self as unknown as { postMessage(m: WorkerReply): void }).postMessage(m);

/** the trips of one day, cached: the page asks "earlier / later" for the same day over and over */
function dayTrips(job: SearchJob): Trip[] {
  const key = JSON.stringify([job.date, job.school, job.municipalities]);
  let trips = days.get(key);
  if (!trips) {
    if (days.size > 4) days.clear();
    trips = servicesFor(net as Network, lines, job.date, job.school, job.municipalities);
    days.set(key, trips);
  }
  return trips;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  if (m.type === 'init') {
    lines = m.lines;
    net = buildNetwork(lines, m.terminalWalks);
    days.clear();
    post({ id: 0, result: null });
    return;
  }
  try {
    const all = dayTrips(m.job);
    const allowed = m.job.lineIds ? new Set(m.job.lineIds) : null;
    const only = allowed ? all.filter((tr) => allowed.has(tr.line.id)) : all;
    const r = runSearch(net as Network, only, m.job.from, m.job.to, m.job.at, m.job.directOnly);
    post({ id: m.id, result: r && toWire(r) });
  } catch (err) {
    post({ id: m.id, error: String(err) });
  }
};

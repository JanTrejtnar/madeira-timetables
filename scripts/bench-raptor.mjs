// Speed of the journey search in a real browser, with Chrome's CPU throttling standing in for slower phones:
// the existing `plan()` against RAPTOR (src/lib/raptor.ts via raptorAdapter.ts) on the real timetables of one day.
// Usage: node scripts/bench-raptor.mjs [baseUrl]   (dev server running: npx vite --port 5173)
// Options by environment: BENCH_RATES="1,4,6" (CPU slowdown factors), BENCH_QUERIES=120.
import puppeteer from 'puppeteer-core';
import { waitForServer } from './lib-e2e-clock.mjs';

const base = process.argv[2] ?? `http://localhost:${process.env.E2E_PORT ?? process.env.PORT ?? 5173}/`;
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const rates = (process.env.BENCH_RATES ?? '1,4,6').split(',').map(Number);
const queries = Number(process.env.BENCH_QUERIES ?? 120);
await waitForServer();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(base, { waitUntil: 'networkidle0' });
const client = await page.createCDPSession();

/** runs in the page: modules come from the dev server, the timetables from /data/schedules.json */
async function bench(n) {
  const { buildNetwork, servicesFor, nodeIdsOfKeys } = await import('/src/lib/network.ts');
  const { plan } = await import('/src/lib/router.ts');
  const { planRaptor, raptorJourneys, prepare } = await import('/src/lib/raptorAdapter.ts');
  const data = await (await fetch('/data/schedules.json')).json();
  const ms = () => performance.now();
  const rng = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let t0 = ms();
  const net = buildNetwork(data.lines, data.terminalWalks);
  const tNetwork = ms() - t0;
  t0 = ms();
  const trips = servicesFor(net, data.lines, { y: 2026, m: 10, d: 28 }, true, ['Funchal']);
  const tTrips = ms() - t0;
  t0 = ms();
  const prepared = prepare(net, trips);
  const tIndex = ms() - t0;
  const served = [...new Set(trips.flatMap((t) => t.nodes))].filter((id) => net.nodes[id].lat !== undefined);
  const rand = rng(12345);
  const qs = [];
  while (qs.length < n + 10) {
    const a = net.nodes[served[Math.floor(rand() * served.length)]];
    const b = net.nodes[served[Math.floor(rand() * served.length)]];
    if (a.key !== b.key) qs.push({ A: nodeIdsOfKeys(net, [a.key]), B: nodeIdsOfKeys(net, [b.key]), at: 360 + Math.floor(rand() * 840) });
  }
  const methods = {
    'plan() (current)': (q) => plan(net, trips, q.A, q.B, q.at),
    'planRaptor (3 h, then 24 h, <=100 runs)': (q) => planRaptor(net, trips, q.A, q.B, q.at),
    'raptorJourneys 3 h': (q) => raptorJourneys(net, trips, q.A, q.B, q.at, undefined, undefined, { window: 180 }),
    'raptorJourneys 12 h': (q) => raptorJourneys(net, trips, q.A, q.B, q.at, undefined, undefined, { window: 720 }),
  };
  const out = {};
  for (const [name, fn] of Object.entries(methods)) {
    for (const q of qs.slice(0, 10)) fn(q); // warm-up
    const times = [];
    for (const q of qs.slice(10)) {
      const s = ms();
      fn(q);
      times.push(ms() - s);
    }
    times.sort((a, b) => a - b);
    out[name] = { median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)], max: times[times.length - 1] };
  }
  return { tNetwork, tTrips, tIndex, trips: trips.length, patterns: prepared.index.patternCount, stops: net.nodes.length, out };
}

const f = (x) => x.toFixed(1).padStart(7);
for (const rate of rates) {
  await client.send('Emulation.setCPUThrottlingRate', { rate });
  const r = await page.evaluate(bench, queries);
  console.log(`\n=== CPU slowdown ${rate}x  (${r.stops} stops, ${r.trips} trips, ${r.patterns} patterns; ${queries} random stop-to-stop queries, ms)`);
  console.log(`one-off: network ${r.tNetwork.toFixed(0)} ms, day's trips ${r.tTrips.toFixed(0)} ms, RAPTOR index ${r.tIndex.toFixed(0)} ms`);
  console.log(`${'method'.padEnd(40)} median     p95     max`);
  for (const [name, s] of Object.entries(r.out)) console.log(`${name.padEnd(40)}${f(s.median)} ${f(s.p95)} ${f(s.max)}`);
}
await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
await browser.close();

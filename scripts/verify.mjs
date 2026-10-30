// The pipeline from CLAUDE.md in one command: node scripts/verify.mjs [--skip-e2e]
// E2E suites need the dev server: E2E_PORT (or PORT, default 5173) is used when it serves this app; when the port is free or taken by
// another project's server, a Vite dev server of this project is started on a free port for the run. Stops at the first failing step.
// Every step has its own time limit; the limits leave room for a loaded machine (e2e-ux alone takes ~105 s).
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const e2e = (name, s) => ({ name: `e2e ${name}`, cmd: 'node', args: [`scripts/e2e-${name}.mjs`], s });
const steps = [
  { name: 'build:data', cmd: npm, args: ['run', 'build:data'], s: 180 },
  // positions may have changed -> redraw the stale directions only (a no-op when nothing changed), then rebuild
  { name: 'fetch:routes', cmd: npm, args: ['run', 'fetch:routes'], s: 600 },
  { name: 'build:data (after routes)', cmd: npm, args: ['run', 'build:data'], s: 180, onlyIfChanged: true },
  // a redrawn direction leaves the detours through its "Via" places without their anchor points: fetch them again (a no-op when nothing changed)
  { name: 'fetch:via-routes', cmd: npm, args: ['run', 'fetch:via-routes'], s: 900 },
  { name: 'build:data (after via routes)', cmd: npm, args: ['run', 'build:data'], s: 180, onlyIfChanged: true },
  { name: 'tsc -b', cmd: npx, args: ['tsc', '-b'], s: 240 },
  { name: 'vitest', cmd: npm, args: ['test'], s: 300 },
  ...(process.argv.includes('--skip-e2e')
    ? []
    : [e2e('line96', 120), e2e('line208', 120), e2e('trim-notes', 120), e2e('ux', 240), e2e('planner', 240), e2e('transfers', 120), e2e('map', 180), e2e('mobile', 180), e2e('robust', 120), e2e('offline-map', 120), e2e('gtfs-lines', 180)]),
  { name: 'vite build', cmd: npm, args: ['run', 'build'], s: 300 },
];


/** Fingerprint of what the fetch steps write (routes, via detours, shape files); a repeated build:data is skipped when it did not move since the last build. */
function routeFingerprint() {
  const h = createHash('sha1');
  for (const f of ['data/routes.json', 'data/via-routes.json']) h.update(existsSync(f) ? readFileSync(f) : '');
  const d = 'data/shapes';
  if (existsSync(d)) for (const n of readdirSync(d).sort()) h.update(`${n}:${statSync(`${d}/${n}`).size}:${Math.round(statSync(`${d}/${n}`).mtimeMs)};`);
  return h.digest('hex');
}
let builtWith = null;

const wantedPort = Number(process.env.E2E_PORT ?? process.env.PORT ?? 5173);
let devServer = null;

/** True when http://localhost:port/ serves this app (its data/schedules.json parses as JSON with lines). */
async function servesThisApp(port) {
  try {
    const r = await fetch(`http://localhost:${port}/data/schedules.json`, { signal: AbortSignal.timeout(5000) });
    return Array.isArray((await r.json()).lines);
  } catch {
    return false;
  }
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer().unref().on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

/** Port for the E2E suites: the wanted one when it serves this app, otherwise a dev server of this project on a free port. */
async function ensureServer() {
  if (await servesThisApp(wantedPort)) return wantedPort;
  const port = await freePort();
  console.log(`port ${wantedPort} does not serve this app -> starting Vite on port ${port} for the E2E suites`);
  devServer = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
  for (let i = 0; i < 120; i++) {
    if (await servesThisApp(port)) return port;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite did not start on port ${port}`);
}

function stopServer() {
  if (!devServer?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(devServer.pid), '/T', '/F'], { stdio: 'ignore' });
  else devServer.kill();
  devServer = null;
}
const fail = (msg) => {
  console.error(msg);
  stopServer();
  process.exit(1);
};

for (const st of steps) {
  if (st.name.startsWith('e2e ') && !process.env.E2E_PORT_RESOLVED) process.env.E2E_PORT_RESOLVED = process.env.E2E_PORT = String(await ensureServer());
  if (st.onlyIfChanged && builtWith === routeFingerprint()) {
    console.log(`\n=== ${st.name}: skipped (the fetch step before it changed nothing)`);
    continue;
  }
  const t0 = Date.now();
  console.log(`\n=== ${st.name} (limit ${st.s} s)`);
  const r = spawnSync(st.cmd, st.args, { stdio: 'inherit', timeout: st.s * 1000, shell: process.platform === 'win32' });
  const took = Math.round((Date.now() - t0) / 1000);
  if (r.error?.code === 'ETIMEDOUT' || r.signal) {
    fail(`FAILED: ${st.name} exceeded ${st.s} s (${took} s)`);
  }
  if (r.status !== 0) {
    fail(`FAILED: ${st.name} (exit ${r.status}, ${took} s)`);
  }
  if (st.name.startsWith('build:data')) builtWith = routeFingerprint();
  console.log(`ok: ${st.name} (${took} s)`);
}
stopServer();
console.log('\nPipeline passed.');

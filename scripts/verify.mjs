// The pipeline from CLAUDE.md in one command: node scripts/verify.mjs [--skip-e2e]
// Needs the dev server for the E2E suites (npx vite --port 5173). Stops at the first failing step.
// Every step has its own time limit; the limits leave room for a loaded machine (e2e-ux alone takes ~150 s).
import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const e2e = (name, s) => ({ name: `e2e ${name}`, cmd: 'node', args: [`scripts/e2e-${name}.mjs`], s });
const steps = [
  { name: 'build:data', cmd: npm, args: ['run', 'build:data'], s: 180 },
  // positions may have changed -> redraw the stale directions only (a no-op when nothing changed), then rebuild
  { name: 'fetch:routes', cmd: npm, args: ['run', 'fetch:routes'], s: 600 },
  { name: 'build:data (after routes)', cmd: npm, args: ['run', 'build:data'], s: 180 },
  { name: 'tsc -b', cmd: npx, args: ['tsc', '-b'], s: 240 },
  { name: 'vitest', cmd: npm, args: ['test'], s: 300 },
  ...(process.argv.includes('--skip-e2e')
    ? []
    : [e2e('line96', 120), e2e('line208', 120), e2e('trim-notes', 120), e2e('ux', 240), e2e('planner', 240), e2e('map', 180), e2e('mobile', 180)]),
  { name: 'vite build', cmd: npm, args: ['run', 'build'], s: 300 },
];

for (const st of steps) {
  const t0 = Date.now();
  console.log(`\n=== ${st.name} (limit ${st.s} s)`);
  const r = spawnSync(st.cmd, st.args, { stdio: 'inherit', timeout: st.s * 1000, shell: process.platform === 'win32' });
  const took = Math.round((Date.now() - t0) / 1000);
  if (r.error?.code === 'ETIMEDOUT' || r.signal) {
    console.error(`FAILED: ${st.name} exceeded ${st.s} s (${took} s)`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`FAILED: ${st.name} (exit ${r.status}, ${took} s)`);
    process.exit(1);
  }
  console.log(`ok: ${st.name} (${took} s)`);
}
console.log('\nPipeline passed.');

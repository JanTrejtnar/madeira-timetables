// Copies parsed data into public/ for the app: schedules.json, route geometries and (small) original PDFs
// of lines whose schedule could not be parsed. Everything else links to the original siga.madeira.gov.pt PDF.
import { cp, mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addEstimates } from './lib-estimate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public');
const MAX_LOCAL_PDF = 1_000_000;
const data = JSON.parse(await readFile(path.join(ROOT, 'data', 'schedules.json'), 'utf8'));

await rm(path.join(OUT, 'data'), { recursive: true, force: true });
await rm(path.join(OUT, 'pdf'), { recursive: true, force: true });
await mkdir(path.join(OUT, 'data'), { recursive: true });
await mkdir(path.join(OUT, 'pdf'), { recursive: true });

let local = 0;
let estimated = 0;
const rejected = [];
for (const l of data.lines) {
  delete l.warnings; // parser diagnostics are not needed in the app
  estimated += addEstimates(l, path.join(ROOT, 'data', 'shapes'));
  // keep only the legend entries that some departure refers to (SAM sheets carry a 30-line legend)
  const used = new Set();
  for (const d of l.directions) {
    for (const list of Object.values(d.departures)) for (const x of list) (x.notes ?? []).forEach((n) => used.add(n));
    for (const tr of d.trips ?? []) (tr.notes ?? []).forEach((n) => used.add(n));
  }
  l.notes = Object.fromEntries(Object.entries(l.notes ?? {}).filter(([k]) => used.has(k)));
  for (const d of l.directions) if (d.estimateRejected) rejected.push(`${l.number}: ${d.estimateRejected}`);
  const src = path.join(ROOT, 'data', 'raw', l.pdfFile);
  if (!l.hasParsedSchedule && (await stat(src)).size <= MAX_LOCAL_PDF) {
    const name = path.basename(l.pdfFile);
    await cp(src, path.join(OUT, 'pdf', name));
    l.pdfLocal = `pdf/${name}`;
    local++;
  }
  delete l.pdfFile;
}
await writeFile(path.join(OUT, 'data', 'schedules.json'), JSON.stringify(data));
await cp(path.join(ROOT, 'data', 'shapes'), path.join(OUT, 'data', 'shapes'), { recursive: true });
console.log('estimated directions:', estimated, rejected.length ? `(rejected: ${rejected.join('; ')})` : '');
console.log('public/ updated:', data.lines.length, 'lines,', (await readdir(path.join(OUT, 'data', 'shapes'))).length, 'shapes,', local, 'local pdfs');

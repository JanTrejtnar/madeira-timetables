// Scraper for https://siga.madeira.gov.pt/horarios
// Idempotent: anything already in data/raw/ is skipped. 1 network request per DELAY_MS.
// Usage: node scripts/scrape.mjs [--limit N]
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://siga.madeira.gov.pt';
const DELAY_MS = 1000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const MUNICIPALITIES = {
  279: 'Calheta', 280: 'Câmara de Lobos', 281: 'Funchal', 282: 'Machico', 283: 'Ponta do Sol',
  284: 'Porto Moniz', 285: 'Ribeira Brava', 286: 'Santa Cruz', 287: 'Santana', 288: 'São Vicente',
  289: 'Porto Santo',
};

const exists = (p) => access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastReq = 0;
let netCount = 0;

async function throttledFetch(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    const wait = lastReq + DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    netCount++;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'madeira-timetables-personal-scraper/1.0' } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status >= 400 && res.status < 500) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (e.fatal || i === tries) throw new Error(`${url}: ${e.message}`);
      await sleep(2000 * i);
    }
  }
}

/** Fetch `url` into `file` unless cached. Returns the cached/fetched Buffer. */
async function cached(url, file) {
  if (await exists(file)) return readFile(file);
  const buf = await throttledFetch(url);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
  return buf;
}

const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function parseIndex(html) {
  const chunks = html.split(/<div class="card text-dark bg-light mt-4 cardsrounded carreira /).slice(1);
  const lines = [];
  for (const c of chunks) {
    const cls = c.match(/^([^"]*)"/)[1].trim().split(/\s+/); // "281 urbano"
    const id = c.match(/horarios\/(\d+)"/)?.[1];
    const h3 = [...c.matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map((m) => text(m[1]));
    // h3 order: old number, current number, name
    const [oldNo, newNo, name] = h3;
    const route = text(c.match(/<small class="text-muted">([\s\S]*?)<\/small>/)?.[1] ?? '');
    if (!id) continue;
    lines.push({
      id: Number(id),
      number: newNo, oldNumber: oldNo, name, route,
      municipalityId: Number(cls[0]), municipality: MUNICIPALITIES[cls[0]] ?? null,
      type: cls[1],
    });
  }
  return lines;
}

function parseDetail(html) {
  const pdf = html.match(/storage\/horarios_pdf\/[^"]+\.pdf/)?.[0] ?? null;
  const jpg = html.match(/storage\/horarios_jpg\/[^"]+\.jpg/)?.[0] ?? null;
  const dirs = new Map();
  for (const m of html.matchAll(/requestShapeData\((\d+),\s*(['"])(.*?)\2\)/g)) {
    if (!dirs.has(m[1])) dirs.set(m[1], m[3].replace(/&amp;/g, '&'));
  }
  // Prefer the dropdown buttons (full set of directions, with proper names)
  const btn = [...html.matchAll(/requestShapeData\((\d+),'([^']*)'\)">([^<]*)</g)];
  const directions = btn.length
    ? btn.map((m) => ({ shapeId: Number(m[1]), name: text(m[3]) }))
    : [...dirs].map(([shapeId, name]) => ({ shapeId: Number(shapeId), name }));
  const heading = text(html.match(/<h3 class="fw-bold mb-0">([\s\S]*?)<\/h3>/)?.[1] ?? '');
  return { pdf: pdf && `${BASE}/${pdf}`, jpg: jpg && `${BASE}/${jpg}`, directions, heading };
}

async function main() {
  const failures = [];
  const indexHtml = (await cached(`${BASE}/horarios`, path.join(RAW, 'index.html'))).toString('utf8');
  const lines = parseIndex(indexHtml).slice(0, LIMIT);
  console.log(`Index: ${lines.length} lines`);

  let n = 0;
  for (const line of lines) {
    n++;
    const tag = `[${n}/${lines.length}] ${line.number} (id ${line.id})`;
    try {
      const html = (await cached(`${BASE}/horarios/${line.id}`, path.join(RAW, 'pages', `${line.id}.html`))).toString('utf8');
      Object.assign(line, parseDetail(html));
      if (!line.pdf) failures.push({ line: line.number, id: line.id, step: 'detail', error: 'no PDF link' });
      else {
        const file = path.basename(line.pdf);
        line.pdfFile = `pdf/${file}`;
        await cached(line.pdf, path.join(RAW, 'pdf', file));
      }
      for (const d of line.directions) {
        try {
          await cached(`${BASE}/horarios/shapedata/${d.shapeId}`, path.join(RAW, 'shape', `${d.shapeId}.json`));
        } catch (e) {
          failures.push({ line: line.number, id: line.id, step: `shape ${d.shapeId}`, error: e.message });
        }
      }
      console.log(`${tag} ok  dirs=${line.directions.length} pdf=${line.pdf ? 'y' : 'N'}`);
    } catch (e) {
      failures.push({ line: line.number, id: line.id, step: 'fetch', error: e.message });
      console.log(`${tag} FAILED ${e.message}`);
    }
    // keep metadata current in case of interruption
    await writeFile(path.join(ROOT, 'data', 'lines.json'), JSON.stringify(lines, null, 2));
  }
  await writeFile(path.join(ROOT, 'data', 'scrape-failures.json'), JSON.stringify(failures, null, 2));
  console.log(`Done. network requests: ${netCount}, failures: ${failures.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

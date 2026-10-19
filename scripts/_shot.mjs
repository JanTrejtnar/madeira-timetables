// Dev helper: screenshot of a PDF in Chrome's viewer, optionally a zoomed crop given in PDF points.
// node scripts/_shot.mjs <pdf> <png> [x0 y0 x1 y1]   (points from the top-left of the page; page is 595 x ~657)
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [pdf, out, ...crop] = process.argv.slice(2);
const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: ['--no-sandbox', '--window-size=2400,2400'],
});
const p = await b.newPage();
const big = crop.length === 4;
await p.setViewport({ width: big ? 2400 : 1500, height: big ? 2400 : 1000 });
await p.goto(pathToFileURL(path.resolve(pdf)).href + '#zoom=page-fit&toolbar=0', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 3500));
if (big) {
  // page-fit: the page fills the viewport height; find its box by probing the screenshot is overkill, so derive it
  const [x0, y0, x1, y1] = crop.map(Number);
  const H = 2400;
  const pageH = 657.036;
  const scale = H / pageH;
  const pageW = 594.96 * scale;
  const left = (2400 - pageW) / 2;
  await p.screenshot({ path: out, clip: { x: left + x0 * scale, y: y0 * scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale } });
} else await p.screenshot({ path: out });
await b.close();

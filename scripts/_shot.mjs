// Dev helper: render a PDF in Chrome's viewer to a PNG (for reading scanned timetables by eye).
// node scripts/_shot.mjs <pdf> <png> [dpr=2] [width=1000] [height=1300] [page=1] [x y w h]  (clip in CSS px of the viewport)
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [pdf, out, dpr = '2', w = '1000', h = '1300', page = '1', ...clip] = process.argv.slice(2);
const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: ['--no-sandbox', `--window-size=${+w + 40},${+h + 140}`],
});
const p = await b.newPage();
await p.setViewport({ width: +w, height: +h, deviceScaleFactor: +dpr });
await p.goto(pathToFileURL(path.resolve(pdf)).href + `#page=${page}&zoom=page-fit&toolbar=0`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 4500));
const c = clip.length === 4 ? { x: +clip[0], y: +clip[1], width: +clip[2], height: +clip[3] } : undefined;
await p.screenshot({ path: out, ...(c ? { clip: c } : {}) });
await b.close();

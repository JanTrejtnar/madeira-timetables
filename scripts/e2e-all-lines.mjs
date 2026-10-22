// Opens every line with parsed times in the running dev server (phone viewport) and checks that the page renders without
// errors, shows departure times and not the "could not parse" warning. Usage: node scripts/e2e-all-lines.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import { freezeClock } from './lib-e2e-clock.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const data = await (await fetch(`${base}data/schedules.json`)).json();
const lines = data.lines.filter((l) => l.hasParsedSchedule);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--lang=cs-CZ'] });
freezeClock(browser);
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base, { waitUntil: 'networkidle0' });

const bad = [];
for (const l of lines) {
  const before = errors.length;
  await page.evaluate((id) => (location.hash = `#/line/${id}`), l.id);
  await page.waitForFunction((id) => location.hash === `#/line/${id}` && document.querySelector('h1'), { timeout: 8000 }, l.id).catch(() => {});
  await new Promise((r) => setTimeout(r, 150));
  const text = await page.evaluate(() => document.body.innerText);
  const times = (text.match(/\d\d:\d\d/g) ?? []).length;
  const problems = [];
  if (/nepodařilo automaticky/.test(text)) problems.push('warning shown');
  if (times < 2) problems.push(`only ${times} times`);
  if (errors.length > before) problems.push('console error: ' + errors.slice(before).join(' | ').slice(0, 120));
  if (problems.length) bad.push(`${l.number || l.oldNumber} (id ${l.id}, ${l.family}): ${problems.join('; ')}`);
}
await browser.close();
console.log(`${lines.length} lines opened, ${bad.length} problems`);
for (const b of bad) console.log('  ' + b);
process.exit(bad.length ? 1 : 0);

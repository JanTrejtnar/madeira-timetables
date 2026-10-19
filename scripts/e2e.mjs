// End-to-end smoke test: drives the running dev server (npm run dev / dev:mobile) in headless Chrome at phone size.
// Text based on purpose (the UI is restyled often).   Usage: node scripts/e2e.mjs [baseUrl]
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:5173/';
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const text = () => page.evaluate(() => document.body.innerText);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
};
/** click the first button whose text contains `label` */
async function clickButton(label, within = 'body') {
  const handle = await page.evaluateHandle(
    (l, w) => [...document.querySelector(w).querySelectorAll('button')].find((b) => b.offsetParent && (b.innerText || b.getAttribute('aria-label') || '').includes(l)) ?? null,
    label,
    within,
  );
  const el = handle.asElement();
  if (!el) return false;
  await el.click();
  await sleep(250);
  return true;
}
const openLine = async (id) => {
  await page.goto(`${base}#/line/${id}`, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('h1,h2'), { timeout: 5000 });
  await sleep(300);
};
const timeCount = (t) => (t.match(/\d\d:\d\d/g) ?? []).length;

const data = await (await fetch(`${base}data/schedules.json`)).json();
const byNum = (n, fam) => data.lines.find((l) => (l.number === n || l.oldNumber === n) && (!fam || l.family === fam));

// 1) lines that must show departure times
for (const [num, fam] of [['007'], ['181'], ['142'], ['20', 'sam'], ['23', 'sam'], ['111', 'sam']]) {
  const l = byNum(num, fam);
  await openLine(l.id);
  const t = await text();
  check(`line ${num}${fam ? ' (' + fam + ')' : ''}: no "could not parse" warning`, !/nepodařilo automaticky/.test(t));
  check(`line ${num}${fam ? ' (' + fam + ')' : ''}: departure times visible`, timeCount(t) >= 2, `${timeCount(t)} times`);
}

// 2) estimated times on an intermediate stop of line 007, real ones on a SAM line
await openLine(byNum('007').id);
check('line 007: selecting a stop works', await clickButton('BP Campo Barca'));
check('line 007: estimated times marked with ~', /~\s?\d\d:\d\d/.test(await text()));
await openLine(byNum('20', 'sam').id);
check('SAM line 20: a stop with printed times is selectable', await clickButton('Rib. Machico'));
const t20 = await text();
check('SAM line 20: printed (not estimated) times at the stop', timeCount(t20) > 3 && !/~\s?\d\d:\d\d/.test(t20));

// 3) planner
async function planner(from, to, { pick = false, time = '09:00' } = {}) {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(() => (location.hash = ''));
  await clickButton('Odkud');
  await sleep(300);
  const inputs = await page.$$('input[aria-label]');
  const find = async (label) => {
    for (const i of inputs) if ((await i.evaluate((e) => e.getAttribute('aria-label'))) === label) return i;
    return null;
  };
  const iFrom = await find('Odkud');
  const iTo = await find('Kam');
  await iFrom.type(from, { delay: 15 });
  await sleep(300);
  await page.evaluate(() => document.querySelector('ul li button')?.click());
  await iTo.type(to, { delay: 15 });
  if (pick) {
    await sleep(300);
    await page.evaluate(() => document.querySelector('ul li button')?.click());
  } else await page.click('main').catch(() => {});
  await page.$eval('input[type=time]', (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, time);
  await sleep(900);
  return text();
}

const typePressed = await (async () => {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await clickButton('Odkud');
  return page.evaluate(() => [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.innerText.trim()));
})();
check('planner: default type filter is Meziměstské', typePressed.includes('Meziměstské'), JSON.stringify(typePressed));

const t1 = await planner('pinga', 'mercedes');
check('planner: urban connection found in "prefer" mode (Pinga -> Mercedes)', /\d\d:\d\d/.test(t1) && /Pinga/.test(t1));
check('planner: estimated arrival flagged with ~', /~\s?\d\d:\d\d/.test(t1));

const t2 = await planner('machico', 'funchal', { time: '07:00' });
check('planner: SAM stops are searchable (Machico -> Funchal)', /Machico/.test(t2) && timeCount(t2) > 4, `${timeCount(t2)} times`);

await page.goto(base, { waitUntil: 'networkidle0' });
console.log(errors.length ? 'console errors:\n' + errors.join('\n') : 'no console errors');
check('no runtime errors', errors.length === 0);
await browser.close();
process.exit(failed ? 1 : 0);

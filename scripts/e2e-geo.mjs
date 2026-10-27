// "My location" next to the From field: a faked GPS fix near Câmara de Lobos fills the nearest stop and states the walk (dev server on :5173).
import puppeteer from 'puppeteer-core';
const base = process.argv[2] ?? `http://localhost:${process.env.E2E_PORT ?? process.env.PORT ?? 5173}/`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--lang=cs-CZ'] });
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(new URL(base).origin, ['geolocation']);
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 800 });
await page.setGeolocation({ latitude: 32.6485, longitude: -16.9775 });
await page.goto(base, { waitUntil: 'networkidle0' });
await page.click('[data-testid=use-my-location]');
await page.waitForSelector('[data-testid=location-note]', { timeout: 8000 });
const note = await page.$eval('[data-testid=location-note]', (n) => n.innerText);
const from = await page.$eval('input[aria-label="Odkud"]', (i) => i.value);
const ok = /Nejbližší zastávka: .+ \d+ m pěšky/.test(note) && /^Moje poloha \(/.test(from);
console.log(ok ? 'PASS' : 'FAIL', JSON.stringify({ from, note }));
await browser.close();
process.exit(ok ? 0 : 1);

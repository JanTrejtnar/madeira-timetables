// Renders public/icon.svg to the PNG icons the manifest and iOS need (192, 512, maskable 512 with safe-zone padding, 180 apple-touch).
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
const chrome = process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => { try { readFileSync(p); return true; } catch { return false; } });
const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
async function render(size, name, { maskable = false } = {}) {
  await page.setViewport({ width: size, height: size });
  // maskable: full-bleed background, glyph inside the central 80 % safe zone
  const inner = maskable ? `<div style="position:absolute;inset:0;background:#0284c7"></div><div style="position:absolute;inset:10%">${svg.replace('rx="14"', 'rx="0"')}</div>` : svg;
  await page.setContent(`<style>*{margin:0}svg{width:100%;height:100%;display:block}body{width:${size}px;height:${size}px;position:relative;background:transparent}</style>${inner}`);
  writeFileSync(new URL(`../public/${name}`, import.meta.url), await page.screenshot({ omitBackground: true }));
}
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', { maskable: true });
await render(180, 'apple-touch-icon.png', { maskable: true });
await browser.close();
console.log('icons written');

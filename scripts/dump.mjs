import { pdfItems } from './lib-pdf.mjs';
const [file, pg] = process.argv.slice(2);
const it = (await pdfItems(file)).filter((i) => !pg || i.page === +pg);
const rows = [];
for (const i of it.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)) {
  const r = rows.find((r) => r.page === i.page && Math.abs(r.y - i.y) < 3);
  if (r) r.items.push(i); else rows.push({ page: i.page, y: i.y, items: [i] });
}
for (const r of rows) console.log(`p${r.page} y${Math.round(r.y)}`, r.items.sort((a, b) => a.x - b.x).map((i) => `${Math.round(i.x)}:${i.str}`).join(' | ').slice(0, 220));

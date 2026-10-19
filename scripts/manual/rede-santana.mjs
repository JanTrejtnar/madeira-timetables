// Manual transcription of the scanned "Rede Santana" sheet (image-only PDF shared by lines 56, 103 and 138).
// Page 1 = towards Santana / São Jorge / Arco de S. Jorge, page 2 = towards Funchal. Read from the rendered pages
// (node scripts/_shot.mjs) and checked against zoomed crops. Times are printed as "HH.MM" and are approximate
// passing times at the intermediate stops. "-" = does not call.
// Writes data/manual/{5000,5004,5011}.json, which scripts/parse.mjs merges into the schedule.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const A_STOPS = ['Funchal', 'Poiso', 'P. Cruz (Túnel)', 'Ribeiro Frio', 'S. Roque do Faial', 'Cruzinhas', 'Faial', 'Santana', 'São Jorge', 'Cabanas', 'Arco de S. Jorge'];
const B_STOPS = ['Arco de S. Jorge', 'Cabanas', 'São Jorge', 'Santana', 'Faial', 'Cruzinhas', 'S. Roque do Faial', 'Ribeiro Frio', 'Poiso', 'P. Cruz (Túnel)', 'Funchal'];

/** row(day, 'times…', notes) ; a note letter or text list */
const row = (day, times, notes = []) => ({ day, times: times.split(' ').map((t) => (t === '-' ? null : t.replace('.', ':'))), notes });

// ---- towards Santana (page 1), columns = A_STOPS
const A = [
  row('weekday', '07.30 - 08.10 - 08.15 08.30 08.40 09.00 - - -', ['a', 'Via Ilha']),
  row('weekday', '08.10 08.40 - 08.50 09.10 - 09.20 10.00 - - -', ['a', 'Via Lº Galego e St. António']),
  row('weekday', '09.00 09.33 - 09.41 - 10.04 10.10 10.25 - - -'),
  row('weekday', '10.00 10.33 - 10.41 - 11.04 11.10 11.25 - - -'),
  row('weekday', '13.45 14.21 - 14.31 14.47 14.59 15.09 15.27 16.15 16.29 16.40', ['Via Cº Chão, Silveira, A. Marques e Ilha']),
  row('weekday', '16.00 - 16.40 - - - 16.45 17.00 17.35 17.52 18.05', ['Via St. António']),
  row('weekday', '17.05 - 17.45 - 17.55 18.10 18.20 - - - -', ['Até Lº Galego. Via Ach. C. Gordo']),
  row('weekday', '18.00 - 18.43 - - - 18.47 19.02 19.25 19.40 19.50'),
  row('weekday', '18.30 19.06 - 19.18 19.39 19.50 20.00 20.07 20.45 - -', ['Via Silveira, A. Marques e Ilha']),
  row('weekday', '19.30 - 20.10 - 20.15 20.32 20.40 20.57 21.15 21.30 -', ['*Serviço a pedido: St. António']),
  row('saturday', '07.30 08.03 - 08.12 08.33 08.44 08.53 09.13 10.01 10.14 10.25', ['a', 'Via St. António e Ilha']),
  row('saturday', '10.00 10.30 - 10.42 10.59 - 11.05 11.20 - - -', ['a']),
  row('saturday', '13.30 14.04 - 14.13 - 14.30 14.40 14.55 15.15 15.25 15.35', ['*Serviço a pedido: S. Roque do Faial']),
  row('saturday', '18.00 18.30 - 18.40 19.00 19.10 19.20 19.35 20.00 20.15 20.25', ['*Serviço a pedido: St. António e Ilha']),
  row('sunday', '07.30 08.03 - 08.12 08.33 08.45 08.58 09.18 10.03 10.15 10.25', ['a', 'Via St. António e Ilha']),
  row('sunday', '10.30 11.05 - 11.15 - 11.30 11.35 12.00 - - -', ['a']),
  row('sunday', '18.00 18.30 - 18.40 - 18.55 19.05 19.20 19.40 19.55 20.05', ['*Serviço a pedido: S. Roque do Faial, St. António e Ilha']),
];

// ---- towards Funchal (page 2), columns = B_STOPS
const B = [
  row('weekday', '- 05.20 05.35 06.17 06.31 - 06.39 06.56 07.05 - 07.40', ['Via Ilha, A. Marques e Silveira', '*Serviço a pedido: F. Câmara St. António']),
  row('weekday', '- - - - 06.30 06.38 06.54 - - 07.00 07.45', ["De Água d'Alto, às 06h15", '*Serviço a pedido: F. Murta e Lº Galego']),
  row('weekday', '06.20 06.34 06.42 07.02 07.18 - - - - 07.21 08.20'),
  row('weekday_school', '07.20 07.31 07.45 08.15 08.40 - - - - 08.45 09.30', ['Via St. António']),
  row('weekday_holiday', '- - - 08.39 08.45 - - - - 08.50 09.40', ['Via Ilha, A. Marques, Silveira, Cº Chão e St. António']),
  row('weekday', '- - - 11.00 11.15 11.30 - 11.40 11.55 - 12.30'),
  row('weekday', '10.00 10.12 10.25 11.00 11.20 11.32 11.43 - - 11.50 12.40', ['Via St. António']),
  row('weekday_school', '- - - 12.30 12.45 13.00 13.10 13.15 13.30 - 14.25'),
  row('weekday_holiday', '- - - 12.30 13.10 13.20 13.30 13.45 14.00 - -', ['Via Lº Galego']),
  row('weekday', '12.15 12.26 12.38 13.10 - - - - - - -', ['Santana 13.10 / 13.25']),
  row('weekday', '- - - 15.30 15.44 15.54 16.10 - - - -', ['a', 'Via Achada do Cedro Gordo', 'P. Cruz / Funchal: impresso 14.05 / 14.55 (zřejmě chyba)']),
  row('weekday', '16.30 16.38 16.50 17.25 17.50 18.00 - 18.12 18.23 - 19.00', ['a', 'Via Ilha e St. António']),
  row('saturday', '06.00 06.13 06.25 06.45 07.00 07.08 - 07.25 07.30 - 08.10', ['*Serviço a pedido: Silveira, St. António, Lº Galego e S. Roque do Faial']),
  row('saturday', '- - - 12.00 12.16 12.27 12.40 - - 12.50 13.30'),
  row('saturday', '12.30 12.41 12.55 13.15 13.30 - - - - 13.35 14.20', ['a']),
  row('saturday', '16.30 16.38 16.48 17.28 17.50 18.01 18.10 18.30 18.35 - 19.20', ['a', 'Via Ilha e St. António']),
  row('sunday', '07.20 07.30 07.45 08.10 08.30 08.40 - 08.50 09.00 - 09.35', ['*Serviço a pedido: Ilha, A. Marques, Silveira, St. António e S. Roque do Faial']),
  row('sunday', '- - - 15.30 15.46 15.55 16.03 - - 16.10 16.50', ['a']),
  row('sunday', '16.30 16.38 16.48 17.28 17.50 18.01 18.10 18.30 18.35 - 19.20', ['a', 'Via Ilha e St. António']),
];

// ---- short tables (Mon-Fri)
const SMALL = [
  { stops: ['Lº Galego', 'Santana'], rows: [row('weekday', '09.30 10.00', ['*Serviço a pedido: F. Murta']), row('weekday_school', '12.20 13.00', ['*Serviço a pedido: F. Murta']), row('weekday_school', '17.20 17.50', ['*Serviço a pedido: F. Murta'])] },
  { stops: ['Santana', 'Faial', 'Lº Galego'], rows: [row('weekday_school', '12.00 12.10 12.20', ['*Serviço a pedido: F. Murta']), row('weekday_holiday', '12.30 12.40 12.50', ['*Serviço a pedido: F. Murta']), row('weekday_school', '17.00 17.10 17.20', ['*Serviço a pedido: F. Murta'])] },
  { stops: ['Porto da Cruz', 'Faial', 'Santana'], rows: [row('weekday_school', '13.25 14.10 14.25', ['Só no Período Escolar e sujeito ao horário da escola'])] },
  { stops: ['Santana', 'Faial', 'Porto da Cruz'], rows: [row('weekday_school', '13.25 13.35 13.50', ['Só no Período Escolar e sujeito ao horário da escola']), row('weekday_school', '17.00 17.20 17.50', ['Só no Período Escolar e sujeito ao horário da escola'])] },
];

const toTrip = (r) => ({ days: [r.day], times: r.times, ...(r.notes.length ? { notes: r.notes } : {}) });

/** which of the three line records a long-distance trip belongs to */
function owner(stops, times, toward) {
  const idx = times.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
  const end = stops[toward === 'end' ? idx[idx.length - 1] : idx[0]];
  if (end === 'Arco de S. Jorge') return 5004; // line 103
  if (end === 'São Jorge' || end === 'Cabanas') return 5011; // line 138
  return 5000; // line 56 (Santana)
}

const out = { 5000: [], 5004: [], 5011: [] };
const dirOf = (id, stops) => {
  const key = stops.join('>');
  let d = out[id].find((x) => x.key === key);
  if (!d) {
    d = { key, from: stops[0], to: stops[stops.length - 1], stops, trips: [] };
    out[id].push(d);
  }
  return d;
};
for (const r of A) dirOf(owner(A_STOPS, r.times, 'end'), A_STOPS).trips.push(toTrip(r));
for (const r of B) dirOf(owner(B_STOPS, r.times, 'start'), B_STOPS).trips.push(toTrip(r));
for (const s of SMALL) for (const r of s.rows) dirOf(5000, s.stops).trips.push(toTrip(r));

const NOTES = {
  a: 'Viagens de ligação direta ao Parque Temático da Madeira.',
};
const GENERAL = [
  'O horário indica, nos pontos intermédios dos percursos, as horas aproximadas de passagem',
  '*Serviço a pedido: Os clientes deverão efectuar a marcação do serviço, preferencialmente através do email info@cam-madeira.pt ou em último recurso, através do número de telefone 291 201 150. O pedido deverá ser realizado até às 16h00, do dia útil anterior.',
  '3ª feira de carnaval, é praticado horário de dia útil período não letivo.',
  'Não se efectuam viagens no dia 25 de Dezembro.',
];

await mkdir(path.join(ROOT, 'data', 'manual'), { recursive: true });
for (const [id, dirs] of Object.entries(out)) {
  const body = {
    lineId: Number(id),
    source: 'manual transcription of the scanned PDF "Rede Santana" (image only, shared by lines 56, 103, 138)',
    notes: NOTES,
    generalNotes: GENERAL,
    directions: dirs.map(({ key, ...d }) => d),
  };
  await writeFile(path.join(ROOT, 'data', 'manual', `${id}.json`), JSON.stringify(body, null, 1));
  console.log(id, dirs.map((d) => `${d.from}>${d.to} ${d.trips.length}`).join(' | '));
}

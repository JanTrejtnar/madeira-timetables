// Manual transcriptions of two image-only PDFs: line 555 (Carreira 155 Ponta da Oliveira - Funchal, only terminal
// departures) and line 725 (Nº 130 Água Pena / Sant'Ana, trips with arrival times). Read from rendered pages.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
await mkdir(path.join(ROOT, 'data', 'manual'), { recursive: true });
const write = (id, body) => writeFile(path.join(ROOT, 'data', 'manual', `${id}.json`), JSON.stringify(body, null, 1));

// ---- 555: "06:30 a" -> {t, notes}
const dep = (s) =>
  s
    .trim()
    .split(/\s*,\s*/)
    .map((x) => {
      const m = x.match(/^(\d{1,2}):(\d{2})\s*(.*)$/);
      return { t: `${m[1].padStart(2, '0')}:${m[2]}`, ...(m[3] ? { notes: [m[3]] } : {}) };
    });

const PO = {
  weekday: dep('06:30 a, 07:00 a, 07:30 Exp, 07:45 b, 08:10 a, 08:30 Exp, 08:55 b, 10:00 Exp, 10:10 a, 11:00 a, 12:10 a, 13:10 a, 14:15 b, 15:00 a, 16:00 Exp, 16:15 a, 17:00 Exp, 17:10 a, 18:10 b, 18:30 Exp, 18:45 a, 20:00 a, 22:45 a, 23:30 a'),
  saturday: dep('07:00 a, 08:10 c, 08:55 b, 10:10 a, 11:00 a, 12:30 a, 13:10 a, 14:15 b, 15:00 a, 16:15 a, 17:10 b, 18:45 a, 20:00 a, 20:45 a, 23:30 a'),
  sunday: dep('07:15 a, 07:45 a, 09:00 b, 10:10 a, 11:00 a, 12:30 a, 13:10 a, 14:15 b, 15:00 a, 16:15 a, 17:10 b, 20:00 a, 23:30 a'),
};
const FN = {
  weekday: dep('06:30 a, 07:10 a, 07:35 a, 08:00 Exp, 08:10 a, 09:00 Exp, 09:30 a, 10:15 a, 11:30 b, 12:30 a, 13:30 b, 14:15 a, 15:30 Exp, 15:30 a, 16:30 Exp, 16:30 a, 17:15 b, 18:00 Exp, 18:00 a, 18:45 a, 19:10 Exp, 19:15 a, 20:00 a, 21:45 a, 23:30 a, 00:10 a'),
  saturday: dep('06:30 a, 07:10 a, 07:35 a, 08:10 a, 09:30 a, 10:15 a, 11:50 a, 12:30 a, 13:30 b, 14:15 a, 15:30 a, 16:30 a, 17:15 b, 18:00 a, 19:15 a, 20:00 a, 21:45 a, 00:10 a'),
  sunday: dep('06:30 a, 07:15 a, 08:15 a, 09:30 a, 10:15 a, 11:50 a, 12:30 a, 13:30 b, 14:15 a, 15:30 a, 16:30 a, 17:15 b, 17:30 a, 18:45 a, 21:45 a, 00:10 a'),
};
await write(3006, {
  lineId: 3006,
  source: 'manual transcription of a scanned PDF (image only): Carreira 155 Ponta da Oliveira - Funchal',
  notes: { a: 'Via Garajau', b: 'Via Figueirinhas', c: 'Entre a Ponta da Oliveira e a Vargem', Exp: 'Expresso (Pela via rápida)' },
  generalNotes: ['Não se efectuam viagens a 25 de Dezembro.'],
  directions: [
    { from: 'Ponta da Oliveira', to: 'Funchal', stops: [], departures: PO, trips: [] },
    { from: 'Funchal', to: 'Ponta da Oliveira', stops: [], departures: FN, trips: [] },
  ],
});

// ---- 725: Nº 130 Água Pena / Sant'ana (Mon-Fri), two-stop trips
const trip = (a, b, notes) => ({ days: ['weekday'], times: [a.replace('.', ':'), b.replace('.', ':')], ...(notes ? { notes } : {}) });
const V1 = ['Via Cemiterio e Queimada de Cima'];
await write(4010, {
  lineId: 4010,
  source: "manual transcription of a scanned PDF (image only): Nº 130 Agua Pena / Sant'Ana",
  notes: {},
  generalNotes: ['Não se efectuam viagens a 25 de Dezembro.'],
  directions: [
    { from: 'Machico', to: 'Água Pena', stops: ['Machico', 'Água Pena'], trips: [trip('09.45', '10.00', V1), trip('11.00', '11.15', V1), trip('12.00', '12.15', V1), trip('14.00', '14.15', V1), trip('16.30', '16.45', V1), trip('19.05', '19.20', ['Via Queimada de Cima'])] },
    { from: 'Água Pena', to: 'Machico', stops: ['Água Pena', 'Machico'], trips: [trip('10.00', '10.15', V1), trip('11.15', '11.30', V1), trip('12.15', '12.30', V1), trip('14.15', '14.30', V1), trip('16.45', '17.00', V1)] },
    { from: 'Machico', to: "Sant'Ana", stops: ['Machico', "Sant'Ana"], trips: [trip('09.15', '09.30'), trip('10.30', '10.45'), trip('17.00', '17.15')] },
    { from: "Sant'Ana", to: 'Machico', stops: ["Sant'Ana", 'Machico'], trips: [trip('09.30', '09.45'), trip('10.45', '11.00'), trip('17.15', '17.30')] },
  ],
});
console.log('written 3006, 4010');

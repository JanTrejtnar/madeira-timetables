// Manual transcriptions of four SIGA Rodoeste PDFs whose tables are too irregular for the generic "rod" parser
// (per-trip final destinations, stacked blocks, text inserts). Read from the rendered pages (scripts/_shot.mjs).
// Every direction is an origin -> destination pair; departures are the printed departure times.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
await mkdir(path.join(ROOT, 'data', 'manual'), { recursive: true });
const write = (id, body) => writeFile(path.join(ROOT, 'data', 'manual', `${id}.json`), JSON.stringify({ lineId: id, ...body }, null, 1));

/** "08:00 a, 13:30 a b" -> [{t, notes}] */
const dep = (s) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const m = x.match(/^(\d{1,2}):(\d{2})\s*(.*)$/);
      const notes = m[3] ? m[3].split(/\s+/) : [];
      return { t: `${m[1].padStart(2, '0')}:${m[2]}`, ...(notes.length ? { notes } : {}) };
    });
/** direction with printed departures per day key */
const D = (from, to, days, variant = null) => ({
  variant,
  from,
  to,
  stops: [],
  departures: Object.fromEntries(Object.entries(days).map(([k, v]) => [k, dep(v)])),
  trips: [],
});

// ---- 127 Ribeira Brava - Boa Morte até Lugar da Serra
await write(2015, {
  source: 'manual transcription of rod_127.pdf (Carreira 127, SIGA Rodoeste)',
  notes: {
    a: 'com passagem pelo ESPIGÃO',
    b: 'com passagem pelo MORENO',
    c: 'circulação com inicio na Pedra, Moreno, Ribeira Brava',
    d: 'circulação Rª BRAVA - MORENO - PEDRA - Rª BRAVA',
  },
  generalNotes: [
    'P.E. - realiza-se somente no Período Escolar, sujeito ao horário lectivo em vigor. P.N.E. - realiza-se somente no Período NÃO Escolar.',
    'Feriados: Ribeira Brava → Boa Morte 08:45, 11:10; Boa Morte → Ribeira Brava 09:10, 11:35.',
    'Não se realizam viagens a 25 e 26 de Dezembro e 1 de Janeiro.',
  ],
  directions: [
    D('Ribeira Brava', 'Lugar da Serra', { weekday: '08:00 a, 13:30 a, 18:35 a' }, 'via Boa Morte-São Paulo'),
    D('Ribeira Brava', 'Lugar da Serra', { weekday_school: '11:00, 17:35' }, 'via Campanário e Adega'),
    D('Ribeira Brava', 'Boa Morte', { weekday: '11:10', saturday: '08:45, 11:10', sunday: '08:45, 11:20' }),
    D('Ribeira Brava', 'Boa Morte', { weekday: '13:30' }, 'via Moreno, Barreiro e Jardim'),
    D('Ribeira Brava', 'São João', { weekday_school: '18:25' }),
    D('Ribeira Brava', 'Moreno', { weekday: '18:40', sunday: '09:30 d' }),
    D('Lugar da Serra', 'Ribeira Brava', { weekday: '06:30 a, 08:40 a', weekday_school: '07:05 a, 11:35 a' }),
    D('Lugar da Serra', 'Ribeira Brava', { weekday: '14:15' }, 'via Adega e Campanário'),
    D('Boa Morte', 'Ribeira Brava', {
      weekday: '06:00, 06:55, 09:10, 11:35, 14:10 b',
      weekday_school: '07:35, 07:35 b, 12:00 b',
      weekday_holiday: '07:45',
      saturday: '09:10, 11:35',
      sunday: '06:00, 08:15 b, 09:10, 11:45',
    }),
    D('Moreno', 'Ribeira Brava', { sunday: '06:30 c' }),
  ],
});

// ---- 154 Funchal - Francelheira, Furneira e Fontainhas
await write(2022, {
  source: 'manual transcription of rod_154.pdf (Carreira 154, SIGA Rodoeste)',
  notes: {
    a: 'com passagem pela Furneira',
    b: 'com passagem pela Francelheira',
    c: 'termina no Estreito de Câmara de Lobos',
    d: 'não se realiza nos Feriados',
    VR: 'pela VIA RÁPIDA (descendo a Estrada J. A. Pinto-Pedregal até Limoeiro)',
    f: 'via Fonte da Rocha',
    T: 'com transbordo no Estreito C. Lobos',
  },
  generalNotes: ['Não se realizam viagens a 25 de Dezembro', 'Nota: Eventualmente este horário, poderá ser alterado ou reajustado a pedido dos utentes sem AVISO PRÉVIO.'],
  directions: [
    D('Funchal', 'Fontainhas', { weekday: '11:30 a b f, 17:00, 18:05 f, 19:00 a b', saturday: '17:00 T a b' }),
    D('Fontainhas', 'Funchal', { weekday: '06:50, 07:40 a VR, 08:30 a b c, 13:00 b', saturday: '06:50 T a b' }),
    D('Funchal', 'Furneira', { weekday: '16:00 b, 17:00 b' }),
    D('Furneira', 'Funchal', { weekday: '06:45 b VR' }),
    D('Francelheira', 'Funchal', { weekday: '07:55 f', saturday: '08:00', sunday: '08:00' }),
    D('Funchal', 'Francelheira', { saturday: '18:10', sunday: '18:10' }),
    D('Estreito de Câmara de Lobos', 'Fontainhas', { sunday: '09:15 d' }),
    D('Fontainhas', 'Estreito de Câmara de Lobos', { sunday: '06:00 d' }),
  ],
});

// ---- 163 Calheta - Paúl do Mar - Calheta (school period only, Mon-Fri)
await write(2028, {
  source: 'manual transcription of rod_163.pdf (Carreira 163, SIGA Rodoeste)',
  notes: {},
  generalNotes: ['Horário realizado no período escolar, consoante o período lectivo', 'Não se realizam viagens a 25 de Dezembro'],
  directions: [D('Escola da Calheta', 'Paúl do Mar', { weekday_school: '13:30, 16:50' }), D('Paúl do Mar', 'Escola da Calheta', { weekday_school: '07:00, 12:30' })],
});

// ---- 4 Ribeira Brava - Ponta do Sol - Miradouro (Jangão): trips with a time at Ponta do Sol
const trip = (day, a, b, c, notes) => ({ days: [day], times: [a, b, c].map((x) => (x ? x.replace('h', ':') : null)), ...(notes ? { notes } : {}) });
await write(2002, {
  source: 'manual transcription of rod_4miradouro.pdf (Carreira 4, SIGA Rodoeste)',
  notes: { PE: 'Realiza-se somente no período escolar, conforme horário lectivo' },
  generalNotes: ['Não se realizam viagens aos Sábados, Domingos e Feriados.', 'Não se realizam viagens a 25 de Dezembro'],
  directions: [
    {
      variant: null,
      from: 'Rª Brava',
      to: 'Miradouro (Jangão)',
      stops: ['Rª Brava', 'Ponta do Sol', 'Miradouro (Jangão)'],
      trips: [
        trip('weekday', '08h00', '08h05', '08h20'),
        trip('weekday_school', null, '09h20', '09h35', ['PE']),
        trip('weekday', '11h40', '11h45', '12h05'),
        trip('weekday_school', null, '13h15', '13h30', ['PE']),
        trip('weekday_school', null, '16h45', '17h00', ['PE']),
        trip('weekday', '17h10', '17h15', '17h35'),
        trip('weekday_school', null, '18h20', '18h35', ['PE']),
      ],
    },
    {
      variant: null,
      from: 'Miradouro (Jangão)',
      to: 'Rª Brava',
      stops: ['Miradouro (Jangão)', 'Ponta do Sol', 'Rª Brava'],
      trips: [
        trip('weekday_school', '07h40', '07h55', null, ['PE']),
        trip('weekday', '08h20', '08h35', '08h50'),
        trip('weekday_school', '09h35', '09h50', null, ['PE']),
        trip('weekday', '12h10', '12h30', null),
        trip('weekday_school', '13h30', '13h45', null, ['PE']),
        trip('weekday', '17h35', '17h50', '18h00'),
      ],
    },
  ],
});
console.log('written 2002, 2015, 2022, 2028');

// Manual transcriptions (read from rendered PDFs) of: line 3 (Funchal - Estreito e Castelejo), line 27 (Preces - Caldeira),
// line 109A (Moinhos Adufa - Funchal, CAM) and the Aerobus 500 (Aeroporto - Praia Formosa - Funchal).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
await mkdir(path.join(ROOT, 'data', 'manual'), { recursive: true });
const write = (id, body) => writeFile(path.join(ROOT, 'data', 'manual', `${id}.json`), JSON.stringify({ lineId: id, ...body }, null, 1));

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
const D = (from, to, days, variant = null) => ({
  variant,
  from,
  to,
  stops: [],
  departures: Object.fromEntries(Object.entries(days).map(([k, v]) => [k, dep(v)])),
  trips: [],
});

// ---- 3 Funchal - Estreito e Castelejo (SIGA Rodoeste)
await write(2001, {
  source: 'manual transcription of the PDF of Carreira 3 (SIGA Rodoeste)',
  notes: {
    a: 'termina viagem no Estreito de Câmara de Lobos',
    b: 'circula pela VIA RÁPIDA',
    c: 'inicia viagem no Estreito de Câmara de Lobos - PARAGEM DAMASQUEIRO (Estrada João Gonçalves Zarco)',
    d: 'com passagem pela Fonte da Rocha',
    e: 'circulação pela carreira 137 - via Covão-Ernesto-Estrada José Ângelo Pestana de Barros',
    f: 'circulação pela carreira 96',
    g: 'com passagem nas Fontes e Corticeiras',
    h: 'circulação pela carreira 137 - Estreito via Covão',
    T: 'Transbordo no Estreito Câmara de Lobos',
  },
  generalNotes: ['Não se realizam viagens a 25 de Dezembro', 'Nota: Eventualmente este horário, poderá ser alterado ou reajustado a pedido dos utentes sem AVISO PRÉVIO.'],
  directions: [
    D('Funchal', 'Castelejo', {
      weekday: '09:00 f T, 10:30, 11:45 b, 12:45, 14:15 f T, 15:00, 16:10, 17:30 b, 18:05 b, 18:20 f T, 18:45 b, 19:15 f, 19:15 e, 21:35 h',
      saturday: '09:00 f T, 11:15 f, 13:30 e, 16:45, 17:30 T, 18:45 T, 19:50 f T, 21:35 h',
      sunday: '11:15 f, 14:05, 17:00 T, 19:50 f T, 21:35 e',
    }),
    D('Castelejo', 'Funchal', {
      weekday: '06:45 e, 07:15, 08:00 b, 08:55 b g, 10:00, 11:40 b, 12:45 T, 13:55 d, 16:30, 17:25 b, 22:30 b',
      saturday: '07:00 T, 08:00 T, 10:00 h, 12:35 f, 14:30 a, 17:40, 20:40, 22:30 b',
      sunday: '15:05, 18:00 T, 20:40, 22:30 b',
    }),
    D('Funchal', 'Estreito de Câmara de Lobos', { weekday: '17:30 a b' }),
    D('Estreito de Câmara de Lobos', 'Funchal', { weekday: '21:20 c, 00:00 c', saturday: '00:00 c' }),
    D('Estreito de Câmara de Lobos', 'Castelejo', { sunday: '07:30, 08:30, 09:45, 10:45' }),
    D('Castelejo', 'Estreito de Câmara de Lobos', { sunday: '06:00, 07:45, 08:55, 10:00' }),
  ],
});

// ---- 27 Preces - Caldeira (SIGA Rodoeste), valid from 15 September 2025
await write(2008, {
  source: 'manual transcription of the PDF of Carreira 27 Preces - Caldeira (SIGA Rodoeste)',
  notes: {
    a: 'via Centro de Saúde Cª Lobos (Fte. Rocha)',
    b: 'via Serrado do Mar',
    c: 'Partida do Limoeiro - Caldeira - Rancho - VIA RÁPIDA (Limoeiro - Funchal)',
    d: 'VIA RÁPIDA entre Funchal e Santa Rita',
    e: 'VIA RÁPIDA entre Santa Rita e Funchal',
    f: 'termina em Câmara de Lobos',
    g: 'com passagem pela Fonte da Rocha, Torre e Serrado da Adega',
    T: 'Transbordo em Câmara de Lobos',
  },
  generalNotes: [
    'Todas as viagens com partida do Funchal ou Cª Lobos circulam pela Rotunda do Rancho, Preces, Limoeiro, Caldeira e Rancho',
    'Todas as viagens com destino ao Funchal ou Cª Lobos iniciam na Rotunda do Rancho, circulando pelas Preces, Limoeiro, Caldeira e Rancho',
    'Horário a se realizar a partir do dia 15 de Setembro de 2025',
    'Não se realizam viagens a 25 de Dezembro',
  ],
  directions: [
    D('Funchal', 'Preces - Caldeira', {
      weekday: '08:00 a, 09:00 a, 10:00 a b, 11:30 a, 12:05 a, 13:05 a, 14:30 a, 15:30 a b, 16:10 a, 17:00 a, 17:30 a b, 18:30 d a, 19:05 a, 20:00 T CL-20:30, 21:15 T CL-21:35, 22:30 T CL-23:00',
      saturday: '08:00 a, 10:00 a b, 12:05 a, 13:10 a, 15:05 T CL-15:30 a, 17:30, 19:15, 21:15 T CL-21:35',
      sunday: '08:00 T CL-08:30, 10:00 b, 12:05 T CL-12:30, 15:05 T CL-15:30, 17:30, 19:15, 21:15 T CL-21:35',
    }),
    D('Rotunda do Rancho', 'Funchal', {
      weekday: '06:05, 06:45, 07:00, 07:55 c, 08:00 a b, 08:35 a, 09:35 a, 10:40 a, 12:05 a, 12:45 a, 13:50 a, 15:10 a, 16:05 a, 16:50 a, 18:05 e, 19:05 f, 20:35 f',
      saturday: '06:05, 07:05, 08:00 a, 08:35 a, 10:40 a, 12:40 a, 13:45, 15:35, 18:05, 19:50 f',
      sunday: '06:40, 08:00, 08:35 g, 10:40 T, 12:35, 15:35, 18:05, 19:50 f',
    }),
  ],
});

// ---- 109A Moinhos (Adufa) - Funchal (CAM / EACL), Mon-Fri
await write(3004, {
  source: 'manual transcription of the PDF of Carreira 109A (CAM)',
  notes: {},
  generalNotes: ['Não se efectuam viagens a 25 de Dezembro.'],
  directions: [
    D('Moinhos', 'Funchal', { weekday: '06:55' }),
    D('Funchal', 'Moinhos', { weekday: '18:30' }),
    D('Moinhos', 'Vargem', { weekday: '07:40, 12:10, 14:10' }),
    D('Vargem', 'Moinhos', { weekday: '11:40, 13:45' }),
  ],
});

// ---- 500 Aerobus: Aeroporto - Praia Formosa - Funchal. The route diagram prints minutes from the airport for 14 of the 26 stops.
const STOPS = [
  [0, 'Aeroporto'],
  [15, 'Boa Nova'],
  [22, 'Mercado'],
  [24, 'Avenida do Mar'],
  [26, 'Plaza Madeira'],
  [32, 'Avenida do Infante'],
  [35, 'Estrada Monumental'],
  [37, 'Estrada Monumental'],
  [38, 'Lido'],
  [42, 'Fórum Madeira'],
  [44, 'Centromar'],
  [45, 'Rua do Cabrestante'],
  [47, 'Estrada Monumental'],
  [50, 'Praia Formosa'],
];
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const tmin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const AIR = {
  weekday: '08:30 09:00 09:30 10:00 10:30 11:00 11:30 12:00 13:00 14:00 15:00 16:00 17:00 18:00 19:00 20:00 21:00 22:00',
  saturday: '08:30 09:00 09:30 10:00 10:30 11:00 11:30 12:00 14:00 15:00 16:00 17:00 18:00 19:00 20:00 21:00 22:00',
  sunday: '08:30 09:00 09:30 10:30 11:30 12:00 14:00 15:00 16:00 17:00 18:00 19:00 20:00 21:00 22:00',
};
const PF = {
  weekday: '07:00 08:00 08:30 09:00 09:30 10:00 10:30 11:00 12:00 13:00 14:00 15:00 16:00 17:00 18:00 19:00 20:00 21:00',
  saturday: '07:00 08:00 08:30 09:00 09:30 10:00 10:30 11:00 13:00 14:00 15:00 16:00 17:00 18:00 19:00 20:00 21:00',
  sunday: '07:00 08:00 08:30 09:30 10:30 11:00 13:00 14:00 15:00 16:00 17:00 18:00 19:00 20:00 21:00',
};
const trips = Object.entries(AIR).flatMap(([day, s]) => s.split(' ').map((t) => ({ days: [day], times: STOPS.map(([off]) => hhmm(tmin(t) + off)) })));
await write(4022, {
  source: 'manual transcription of the Aerobus PDF: departure times from the airport, minutes from the route diagram (14 of the 26 stops are labelled)',
  notes: {},
  generalNotes: ['Não se efectuam viagens a 25 de Dezembro', 'Praia Formosa → Centro (paragem 6) Av. do Mar: 15/30 min.'],
  directions: [
    { variant: null, from: 'Aeroporto', to: 'Praia Formosa - Funchal', stops: STOPS.map(([, n]) => n), trips },
    D('Praia Formosa - Funchal', 'Aeroporto', Object.fromEntries(Object.entries(PF).map(([k, v]) => [k, v.split(' ').join(', ')]))),
  ],
});
console.log('written 2001, 2008, 3004, 4022');

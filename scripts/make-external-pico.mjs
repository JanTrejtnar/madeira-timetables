// Generates data/external/9001.json: Horários do Funchal "Pico do Areeiro" service, transcribed from
// https://www.horariosdofunchal.pt/index.php/viajar/pico-do-areeiro (read 2026-10-20). Not part of SIGA.
import { writeFileSync } from 'node:fs';
const UP = [
  ['Teleférico - paragem Teleférico-Término (4A)', '06:00', '13:30', { lat: 32.6482, lon: -16.9045, approx: true }],
  ['Jardim Santa Luzia', '06:02', '13:32', { lat: 32.6539, lon: -16.9119 }],
  ['Monte - Largo da Fonte', '06:10', '13:40', { lat: 32.6767, lon: -16.9029 }],
  ['Entrada Corujeira de Dentro', '06:11', '13:41'],
  ['Terreiro da Luta', '06:15', '13:45', { lat: 32.6855, lon: -16.9010 }],
  ['Portão Norte da Herdade do Chão da Lagoa', '06:23', '13:53'],
  ['Poiso', '06:27', '13:57', { lat: 32.7127, lon: -16.8878 }],
  ['CAM Florestal das Serras de Santo António', '06:35', '14:05'],
  ['Parque do Pico do Areeiro', '06:40', '14:10'],
  ['Pico do Areeiro - rotunda junto ao Radar', '06:45', '14:15', { lat: 32.7357, lon: -16.9287 }],
];
const DOWN = [
  ['Pico do Areeiro - rotunda junto ao Radar', '12:15', '19:00'],
  ['Parque do Pico do Areeiro', '12:20', '19:05'],
  ['CAM Florestal das Serras de Santo António', '12:25', '19:10'],
  ['Poiso', '12:33', '19:18'],
  ['Portão Norte da Herdade do Chão da Lagoa', '12:37', '19:22'],
  ['Terreiro da Luta', '12:45', '19:30'],
  ['Entrada Corujeira de Dentro', '12:49', '19:34'],
  ['Monte - Largo da Fonte', '12:50', '19:35'],
  ['Parque estacionamento Santa Luzia', '12:58', '19:43'],
  ['Teleférico - paragem Teleférico - Término (4A)', '13:00', '19:45'],
];
const coordOf = new Map(UP.filter((r) => r[3]).map((r) => [r[0], r[3]]));
coordOf.set('Parque estacionamento Santa Luzia', coordOf.get('Jardim Santa Luzia'));
coordOf.set('Teleférico - paragem Teleférico - Término (4A)', coordOf.get('Teleférico - paragem Teleférico-Término (4A)'));
const NOTE_A = 'No horário de Inverno esta viagem é realizada pelas 18h00';
const days = ['weekday', 'saturday', 'sunday'];
const dir = (rows, from, to, variant) => ({
  variant,
  from,
  to,
  shapeId: variant === 'up' ? 9001 : 9002,
  stopSource: 'pdf',
  // anchors carry OSM coordinates; the stops in between are interpolated along the shape by build:data
  stops: rows.map((r) => ({ code: null, name: r[0], ...(coordOf.get(r[0]) ?? {}) })),
  trips: [1, 2].map((k) => ({ days, times: rows.map((r) => r[k]), ...(variant === 'down' && k === 2 ? { notes: ['a'] } : {}) })),
});
const line = {
  id: 9001,
  number: 'HF Areeiro',
  newNumber: null,
  oldNumber: '',
  name: 'Pico do Areeiro',
  route: 'Funchal (Teleférico) – Monte – Poiso – Pico do Areeiro',
  municipality: 'Funchal',
  type: 'interurbano',
  operator: 'Horários do Funchal',
  sourceUrl: 'https://www.horariosdofunchal.pt/index.php/viajar/pico-do-areeiro',
  pdfUrl: 'https://www.horariosdofunchal.pt/images/pdf/picoareeiro/mapa.pdf',
  jpgUrl: null,
  family: 'external',
  hasParsedSchedule: true,
  notes: { a: NOTE_A },
  generalNotes: [
    'Horário de Verão: 29/03/2026 a 24/10/2026 (última viagem 19h00). Horário de Inverno: 25/10/2026 a 27/03/2027 (última viagem 18h00).',
    'O serviço é prestado todos os dias da semana, incluindo sábados, domingos e feriados, à exceção do dia 25 de dezembro.',
    'A HF reserva-se o direito de não realizar o serviço sempre que as condições atmosféricas não o permitam ou o acesso rodoviário seja interdito.',
  ],
  info: {
    price: { cs: 'Autobus 3,00 € za jízdu; kyvadlo (shuttle) mezi CAM Florestal, Parque a rotundou u radaru 1,20 €. Jízdenky jen u řidiče, hotovost nebo karta, jiné jízdenky a pasy se neuznávají. Děti do 5 let včetně zdarma.', en: 'Bus €3.00 per trip; the shuttle between CAM Florestal, Parque and the radar roundabout €1.20. Tickets only on board, cash or card; no other tickets or passes are accepted. Children up to 5 years free.', pt: 'Autocarro 3,00 € por viagem; shuttle entre CAM Florestal, Parque e rotunda junto ao Radar 1,20 €. Títulos apenas a bordo, dinheiro ou cartão; não são admissíveis outros títulos. Crianças até aos 5 anos isentas.' },
    conditions: { cs: 'Rezervace místa je možná 7 až 2 pracovní dny předem, jen telefonicky na 291 705 555 (po–čt 8:30–12:30 a 14:00–18:00, pá do 17:00), a to jen pro zastávky Teleférico a Pico do Areeiro; rezervovaní musí být na nástupišti 15 min předem. Autobus má 31 míst k sezení, stání není dovoleno (kromě shuttle, která jede každých 15 min od 6:40 do 12:15 a od 14:10 do 19:00 a vyjíždí od čtyř cestujících). Provoz může být kvůli počasí nebo uzavřené silnici zrušen.', en: 'Seat reservation 7 to 2 working days ahead, by phone only: 291 705 555 (Mon–Thu 8:30–12:30 and 14:00–18:00, Fri until 17:00), for the Teleférico and Pico do Areeiro stops only; reserved passengers must be at the stop 15 min before departure. The bus has 31 seats and no standing (except the shuttle, every 15 min 6:40–12:15 and 14:10–19:00, leaving with at least four passengers). The service may be cancelled because of weather or a closed road.', pt: 'Reserva de lugar entre sete e dois dias úteis antes da viagem, apenas pelo telefone 291 705 555 (2ª a 5ª 08h30–12h30 e 14h00–18h00, 6ª até às 17h00), só nas paragens Teleférico e Pico do Areeiro; os passageiros devem estar na paragem 15 min antes. Viaturas com 31 lugares sentados, sem viagem de pé (exceto no shuttle, de 15 em 15 min entre 06h40–12h15 e 14h10–19h00, com pelo menos quatro passageiros). O serviço pode ser cancelado por condições atmosféricas ou estrada interdita.' },
  },
  directions: [
    dir(UP, UP[0][0], UP.at(-1)[0], 'up'),
    dir(DOWN, DOWN[0][0], DOWN.at(-1)[0], 'down'),
  ],
};
for (const d of line.directions) {
  d.departures = {};
  for (const day of days) d.departures[day] = d.trips.map((t) => ({ t: t.times[0], ...(t.notes ? { notes: t.notes } : {}) }));
}
writeFileSync(new URL('../data/external/9001.json', import.meta.url), JSON.stringify(line, null, 1) + '\n');
console.log('ok');

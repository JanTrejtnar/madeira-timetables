// Search aliases: English/Czech/German words and tourist destinations mapped to the names that appear in the timetables.
// Stop and line names stay as printed in Portuguese; this only widens what the typed text matches.
import type { Lang } from '../i18n';
import { norm } from '../../shared/geo.mjs';

export interface Poi {
  id: string;
  /** normalised phrases that trigger the entry (typed completely, or as a prefix of at least 4 characters) */
  aliases: string[];
  /** normalised terms looked up in stop and line names in addition to what was typed */
  terms: string[];
  /** name as shown on the card */
  name: string;
  /** shown when nothing in the timetables serves the place */
  info?: Record<Lang, string>;
  /** normalised terms of the nearest regular stops, offered next to the info card */
  near?: string[];
  /** line (id) that serves the place, offered as a card above the results */
  lineId?: number;
}

export const POIS: Poi[] = [
  {
    id: 'airport',
    aliases: ['airport', 'aeroporto', 'letiste', 'flugplatz', 'flughafen', 'aeropuerto', 'aeroport'],
    terms: ['aeroporto'],
    name: 'Aeroporto',
  },
  {
    id: 'arieiro',
    aliases: ['pico do arieiro', 'pico do areeiro', 'pico arieiro', 'pico areeiro', 'arieiro', 'areeiro summit'],
    terms: ['pico do areeiro'],
    name: 'Pico do Areeiro',
    /** the Horários do Funchal shuttle (data/external/9001.json) */
    lineId: 9001,
  },
  {
    id: 'fanal',
    aliases: ['fanal', 'floresta do fanal'],
    terms: [],
    name: 'Fanal',
    info: {
      cs: 'Do lesa Fanal (náhorní plošina Paul da Serra) nevede v datech SIGA žádná pravidelná linka. Jezdí se autem, taxi nebo organizovaným výletem – podmínky ověřte u provozovatele.',
      en: 'No scheduled SIGA line goes to the Fanal forest (Paul da Serra plateau). People go by car, taxi or an organised tour – check the conditions with the operator.',
      pt: 'Nos dados da SIGA não há carreira regular para a Floresta do Fanal (planalto do Paul da Serra). Vai-se de carro, táxi ou passeio organizado – confirme as condições com o operador.',
    },
  },
  { id: 'ribeiro-frio', aliases: ['ribeiro frio'], terms: ['ribeiro frio'], name: 'Ribeiro Frio' },
  { id: 'cabo-girao', aliases: ['cabo girao', 'cabo girão'], terms: ['cabo girao'], name: 'Cabo Girão' },
  { id: 'curral', aliases: ['curral das freiras', 'curral'], terms: ['curral das freiras'], name: 'Curral das Freiras' },
  {
    id: 'sao-lourenco',
    aliases: ['ponta de sao lourenco', 'ponta sao lourenco', 'sao lourenco', 'ponta de s lourenco'],
    terms: ['d abra', 'ponta de sao lourenco'],
    name: 'Ponta de São Lourenço',
  },
  { id: 'porto-moniz', aliases: ['porto moniz'], terms: ['porto moniz'], name: 'Porto Moniz' },
];

const matches = (nq: string, p: Poi) => p.aliases.map(norm).some((a) => a === nq || (nq.length >= 4 && a.startsWith(nq)) || (a.length >= 5 && nq.includes(a)));

export function poiFor(query: string): Poi | null {
  const nq = norm(query);
  return nq.length >= 3 ? POIS.find((p) => matches(nq, p)) ?? null : null;
}

/** Normalised search texts for a query: the typed text plus the terms of the matching entry (if any). */
export function expandTerms(query: string): string[] {
  const nq = norm(query);
  if (!nq) return [];
  const poi = poiFor(query);
  return poi ? [...new Set([nq, ...poi.terms])] : [nq];
}

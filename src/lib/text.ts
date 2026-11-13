// Safety net for the data file: a string with a leftover HTML entity ("D&#039;Abra") is decoded before it is shown.
// build:data already cleans the data; this runs on the raw JSON text, so the cost is one regex pass.
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };

/** Decodes entities in JSON text; the result is still valid JSON (a decoded quote or backslash is escaped). */
export function decodeEntitiesInJson(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    let ch: string | undefined;
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      ch = code > 31 && code < 0x110000 ? String.fromCodePoint(code) : undefined;
    } else ch = e.toLowerCase() === 'quot' ? '"' : NAMED[e.toLowerCase()];
    if (ch === undefined) return m;
    return ch === '"' || ch === '\\' ? '\\' + ch : ch;
  });
}

/** Stop names shown in the UI language: only places with a plain equivalent (the data keeps the printed Portuguese name). */
const LOCAL_NAMES: Record<string, Record<'cs' | 'en' | 'pt', string>> = {
  aeroporto: { cs: 'Letiště', en: 'Airport', pt: 'Aeroporto' },
};
/** the pole number the operator prints after a stop name ("Rochinha T-32") is not part of the name a traveller knows */
export const withoutPole = (name: string): string => name.replace(/,?\s+T-\d+(?:\s+(?:e\s+)?\d+)*$/, '');
export function localStopName(name: string, lang: 'cs' | 'en' | 'pt'): string {
  const plain = withoutPole(name);
  return LOCAL_NAMES[plain.trim().toLowerCase()]?.[lang] ?? plain;
}

/** The Funchal bus terminals share the stop name "Funchal"; the terminal tells them apart ("Funchal (CAM)"). */
const TERMINALS: Record<string, string> = { rodoeste: 'Rodoeste', teleferico: 'Teleférico', sam: 'SAM', cam: 'CAM' };
export function stopLabel(stop: { name: string; terminal?: string }, lang: 'cs' | 'en' | 'pt'): string {
  const name = localStopName(stop.name, lang);
  const terminal = stop.terminal ? TERMINALS[stop.terminal] : undefined;
  return terminal && stop.name.trim().toLowerCase() === 'funchal' ? `${name} (${terminal})` : name;
}

/**
 * Older versions saved the label as it was shown in the UI language ("Funchal (všechny zastávky)", "My location (Funchal)"), so a place picked in
 * one language kept that language's wording after the switch. These recognise such a label in any language, so it can be reduced to the bare name.
 */
const LEGACY_ALL_STOPS = /\s*\((?:všechny zastávky|all stops|todas as paragens)\)\s*$/i;
const LEGACY_MY_LOCATION = /^(?:Moje poloha|My location|A minha localização) \((.+)\)$/;
export const withoutLegacyAllStops = (text: string): string => text.replace(LEGACY_ALL_STOPS, '');
export const legacyMyLocationName = (text: string): string | null => LEGACY_MY_LOCATION.exec(text.trim())?.[1] ?? null;

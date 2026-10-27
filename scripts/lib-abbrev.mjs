// Printed abbreviations of the operators (SAM / Rodoeste / HF print "P.Cruz", "S.Serra", "S.Cruz") for places that other
// timetables spell in full ("Porto da Cruz"). One physical stop must not be two stops only because of the spelling: the
// abbreviation is resolved before a name is compared with OSM, the SIGA planner dump, other lines or an override (keyOf in
// lib-coords), and a stop whose whole name is the abbreviation is shown under the full name (cleanName in lib-text).
// Only a WHOLE name is expanded: "P. Cruz (Túnel)" (the tunnel between Poiso and Ribeiro Frio) is a different place than "P. Cruz".
// Left alone on purpose: "Cª Lobos" and "Rª Brava" (the terminals of 8 lines: their words find the OSM stop "Ribeira Brava - Cabine" / the platform in Câmara de Lobos,
// while the full town name would only give the town-centre stop 40-155 m away), "C." (Caminho / Centro / Casa by context), "R" (Rua / Ribeira), "St" (Santo / Santa) and "STA" in front of other words
// ("STA Quitéria" -> "Santa Quitéria" would make the word "santa" a token of ~20 more stops and a one-word stop like "Santa" could no longer be placed by its words).

/** normalised abbreviation (lower case, no accents or punctuation) -> full name */
export const ABBREVIATIONS = new Map([
  ['p cruz', 'Porto da Cruz'],
  ['porto cruz', 'Porto da Cruz'],
  ['p moniz', 'Porto Moniz'],
  ['p delgada', 'Ponta Delgada'],
  ['p pargo', 'Ponta do Pargo'],
  ['p sol', 'Ponta do Sol'],
  ['s vicente', 'São Vicente'],
  ['s jorge', 'São Jorge'],
  ['s cruz', 'Santa Cruz'],
  ['st cruz', 'Santa Cruz'],
  ['sta cruz', 'Santa Cruz'],
  ['s serra', 'Santo da Serra'],
  ['st serra', 'Santo da Serra'],
]);

/** normalised key (see norm in lib-coords) -> key of the full name; any other key unchanged */
export function expandKey(key, normalise) {
  const full = ABBREVIATIONS.get(key);
  if (full) return normalise(full);
  return key.replace(/^sta /, 'santa ');
}

/** a stop name that is only an abbreviation ("P.Cruz") -> the full name; any other name unchanged */
export function expandName(name, normalise) {
  return ABBREVIATIONS.get(normalise(name)) ?? name;
}

// SIGA labels some lines "urbano" although they leave their municipality or run long distances. The app treats a line as
// interurbano when it serves more than one municipality (concelho) or its route is longer than 15 km.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { haversineKm, norm } from '../shared/geo.mjs';

export const INTERURBAN_KM = 15;

const CONCELHOS = ['Funchal', 'Câmara de Lobos', 'Ribeira Brava', 'Ponta do Sol', 'Calheta', 'Porto Moniz', 'São Vicente', 'Santana', 'Machico', 'Santa Cruz', 'Porto Santo'];
// printed abbreviations of the municipalities in the SAM sheets
const ALIASES = { 'st cruz': 'Santa Cruz', 'cª lobos': 'Câmara de Lobos', 'c lobos': 'Câmara de Lobos', 'rª brava': 'Ribeira Brava', 'r brava': 'Ribeira Brava' };

const hav = haversineKm;

/** Longest route of the line in km (polyline length of its shapes). */
export function routeKm(line, shapesDir) {
  let max = 0;
  for (const d of line.directions) {
    if (d.shapeId == null) continue;
    const f = path.join(shapesDir, `${d.shapeId}.json`);
    if (!existsSync(f)) continue;
    const poly = JSON.parse(readFileSync(f, 'utf8'));
    let km = 0;
    for (let i = 1; i < poly.length; i++) km += hav(poly[i - 1], poly[i]);
    max = Math.max(max, km);
  }
  return max;
}

/** Municipalities named in the route text and the terminals (stop names are too noisy: "Centro Comercial Funchal"). */
export function namedConcelhos(line) {
  const text = norm([line.name, line.route, ...line.directions.flatMap((d) => [d.from, d.to])].filter(Boolean).join(' | '));
  const found = new Set(CONCELHOS.filter((c) => new RegExp(`(^| )${norm(c)}( |$)`).test(text)).map((c) => c));
  for (const [a, c] of Object.entries(ALIASES)) if (new RegExp(`(^| )${norm(a)}( |$)`).test(text)) found.add(c);
  return found;
}

/**
 * Sets type / isInterurbano (and typeReason + typeSiga when the SIGA label is overridden). Only urban lines can be
 * promoted. Porto Santo is a single municipality on a small island: its lines are never promoted by the municipality rule.
 */
export function classifyLine(line, shapesDir) {
  line.isInterurbano = line.type === 'interurbano';
  if (line.type !== 'urbano') return null;
  const km = routeKm(line, shapesDir);
  const named = namedConcelhos(line);
  if (line.municipality) named.add(line.municipality);
  let reason = null;
  if (km > INTERURBAN_KM) reason = `route ${km.toFixed(1)} km (> ${INTERURBAN_KM} km)`;
  else if (named.size > 1 && line.municipality !== 'Porto Santo') reason = `serves several municipalities: ${[...named].join(', ')}`;
  if (!reason) return null;
  line.typeSiga = line.type;
  line.type = 'interurbano';
  line.isInterurbano = true;
  line.typeReason = reason;
  return reason;
}

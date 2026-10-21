// The four bus operators of the island as the "Linky" catalogue groups them. SIGA publishes one timetable per line without naming
// the operator, so it is derived from the line number ranges and the timetable family (see the tests for the lines in every group).
import type { Line } from '../types';

export type OperatorId = 'hf' | 'rodoeste' | 'sam' | 'cam';

export interface Operator {
  id: OperatorId;
  /** name of the company (not translated) */
  name: string;
  /** accent colour on maps, badges and section headers */
  color: string;
  /** Tailwind classes for the section header and the line badge */
  cls: { bar: string; badge: string; soft: string };
}

export const OPERATORS: Operator[] = [
  { id: 'hf', name: 'Horários do Funchal', color: '#10b981', cls: { bar: 'bg-emerald-600', badge: 'bg-emerald-700', soft: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300' } },
  { id: 'rodoeste', name: 'Rodoeste', color: '#fb923c', cls: { bar: 'bg-orange-600', badge: 'bg-orange-700', soft: 'bg-orange-50 text-orange-800 dark:bg-orange-400/10 dark:text-orange-300' } },
  { id: 'sam', name: 'SAM', color: '#f87171', cls: { bar: 'bg-red-600', badge: 'bg-red-700', soft: 'bg-red-50 text-red-800 dark:bg-red-400/10 dark:text-red-300' } },
  { id: 'cam', name: 'CAM / EACL', color: '#a78bfa', cls: { bar: 'bg-violet-600', badge: 'bg-violet-700', soft: 'bg-violet-50 text-violet-800 dark:bg-violet-400/10 dark:text-violet-300' } },
];

export const operatorById = (id: OperatorId): Operator => OPERATORS.find((o) => o.id === id)!;

/**
 * Horários do Funchal: the town lines (numbers below 200 in the SIGA grid, the shuttle to Pico do Areeiro). Rodoeste: the west and the
 * south-west (numbers 1-399 of the road timetables). SAM: the east (its own timetable sheets and the Machico lines). CAM / EACL: the
 * north (Santana), Santa Cruz, Caniço and Porto Santo (numbers 5xx-9xx).
 */
export function operatorOf(line: Pick<Line, 'number' | 'family' | 'municipality' | 'operator'>): OperatorId {
  const n = parseInt(line.number, 10);
  if (line.operator === 'Horários do Funchal') return 'hf';
  if (line.family === 'sam') return 'sam';
  if ((line.family === 'siga-grid' || line.family === 'unsupported') && n < 200) return 'hf';
  if (line.municipality === 'Machico') return 'sam';
  if (line.municipality === 'Santana' || line.municipality === 'Porto Santo') return 'cam';
  if (['rod', 'passage', 'manual', 'rowtables'].includes(line.family) && n < 400) return 'rodoeste';
  return 'cam';
}

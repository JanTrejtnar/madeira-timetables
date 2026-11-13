import type { Line } from '../types';

/** The numbers a traveller may know the line by on the bus: the new ones (one per direction after a renumbering), else the number itself. */
export function lineNumbers(line: Pick<Line, 'number' | 'newNumber' | 'newNumbers'>): string[] {
  if (line.newNumbers?.length) return line.newNumbers;
  return [line.newNumber || line.number];
}

/** "380 / 381": what the line page shows next to "formerly 80". */
export const lineNumberLabel = (line: Pick<Line, 'number' | 'newNumber' | 'newNumbers'>) => lineNumbers(line).join(' / ');

/** The old number worth showing as "formerly …": only when it differs from what the line is called now. */
export function formerNumber(line: Pick<Line, 'number' | 'newNumber' | 'newNumbers' | 'oldNumber'>): string | null {
  if (!line.oldNumber) return null;
  const now = lineNumbers(line);
  if (line.newNumbers?.length) return now.includes(line.oldNumber) ? null : line.oldNumber;
  return line.newNumber && line.oldNumber !== String(Number(line.newNumber)) ? line.oldNumber : null;
}

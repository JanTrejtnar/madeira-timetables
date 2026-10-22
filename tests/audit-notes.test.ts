import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe.skipIf(!existsSync('data/schedules.json'))('legend notes', () => {
  it('none is cut off by the PDF parser once data/note-fixes.json is applied (scripts/audit-notes.mjs)', () => {
    // exits with 1 and lists the line and note when a legend text ends in a dash / preposition or a code has no text
    const out = execFileSync(process.execPath, ['scripts/audit-notes.mjs', '--strict'], { encoding: 'utf8' });
    expect(out).toContain('0 lines with suspicious notes');
  });

  it('line 704: the footnote "bg" that the PDF font encodes as "EJ" is read as Via Bemposta + Via Gaula', () => {
    const data = JSON.parse(readFileSync('public/data/schedules.json', 'utf8'));
    const l = (data.lines ?? data).find((x: { number: string }) => x.number === '704');
    const codes = new Set<string>();
    for (const d of l.directions) for (const list of Object.values<{ notes?: string[] }[]>(d.departures)) for (const x of list) (x.notes ?? []).forEach((c) => codes.add(c));
    expect([...codes]).not.toContain('J');
    expect([...codes]).not.toContain('4');
    expect(l.notes.b).toBe('Via Bemposta');
    expect(l.notes.g).toBe('Via Gaula');
    const maroçosToMachico = l.directions[1].departures.weekday.find((x: { t: string }) => x.t === '07:30');
    expect(maroçosToMachico.notes).toEqual(['t', 'b', 'g']);
  });
});

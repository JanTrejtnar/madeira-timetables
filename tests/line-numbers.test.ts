import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script
import { applyLineNumberOverrides, lineNumberProblems } from '../scripts/lib-line-numbers.mjs';
import { buildIndex, searchLines } from '../src/lib/search';
import { formerNumber, lineNumberLabel } from '../src/lib/lineNumber';
import { dirLabel } from '../src/components/common';
import type { Line } from '../src/types';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const overrides = read('line-number-overrides.json').lines as Record<string, { newNumbers: string[]; directions?: { from?: string; to?: string; number: string }[] }>;

const dir = (from: string, to: string) => ({ variant: null, from, to, shapeId: null, stopSource: 'pdf', stops: [], departures: {} });
const line = (id: number, number: string, dirs = [dir('Funchal', 'Porto Moniz'), dir('Porto Moniz', 'Funchal')]) => ({ id, number, newNumber: null, oldNumber: number, name: `L${number}`, route: '', municipality: null, type: 'interurbano', directions: dirs }) as unknown as Line;

describe('line-number-overrides.json on synthetic lines', () => {
  it('writes the new numbers and gives each direction its own, the technical number stays', () => {
    const lines = [line(1, '80')];
    const o = { '1': { newNumbers: ['380', '381'], directions: [{ from: 'Funchal', to: 'Porto Moniz', number: '380' }, { from: 'Porto Moniz', to: 'Funchal', number: '381' }] } };
    expect(applyLineNumberOverrides(lines, o)).toBe(1);
    expect(lines[0]).toMatchObject({ number: '80', newNumbers: ['380', '381'] });
    expect(lines[0]!.directions.map((d) => d.number)).toEqual(['380', '381']);
  });
  it('names every problem: unknown id, a direction that is not there, a number of another line, a number outside the list', () => {
    const lines = [line(1, '80'), line(2, '380')];
    const p = lineNumberProblems(lines, {
      '9': { newNumbers: ['390'] },
      '1': { newNumbers: ['380', 'x1'], directions: [{ from: 'Calheta', number: '380' }, { from: 'Funchal', number: '555' }] },
    });
    expect(p.join('\n')).toMatch(/9: no line with this id/);
    expect(p.join('\n')).toMatch(/"380" is already the number of line 2/);
    expect(p.join('\n')).toMatch(/"x1" is not a line number/);
    expect(p.join('\n')).toMatch(/matches no direction/);
    expect(p.join('\n')).toMatch(/"555" is not in newNumbers/);
    expect(() => applyLineNumberOverrides(lines, { '9': { newNumbers: ['390'] } })).toThrow(/no line with this id/);
  });
  it('two old lines may share a new number (the renumbering merges them), but not take one SIGA already gave to a line', () => {
    expect(lineNumberProblems([line(1, '80'), line(2, '81')], { '1': { newNumbers: ['850'] }, '2': { newNumbers: ['850'] } })).toEqual([]);
    expect(lineNumberProblems([line(1, '80'), line(2, '81')], { '1': { newNumbers: ['81'] } }).join()).toMatch(/already the number of line 2 in SIGA's index/);
  });
});

describe('the real overrides', () => {
  const data = read('schedules.json').lines as Line[];
  const applied = structuredClone(data);
  it('fit the parsed data (build:data would stop otherwise)', () => {
    expect(lineNumberProblems(data, overrides)).toEqual([]);
    expect(applyLineNumberOverrides(applied, overrides)).toBe(Object.keys(overrides).length);
  });
  it('line 80 is found as 380 and 381, line 139 as 340 and 341, and still as the old number', () => {
    const ix = buildIndex(applied);
    for (const [q, id] of [['380', 2009], ['381', 2009], ['80', 2009], ['340', 2017], ['341', 2017], ['139', 2017]] as const) expect(searchLines(ix, q)[0]?.id, q).toBe(id);
  });
  it('the CAM Santana lines (56, 103, 138) and line 139 are found by their new numbers', () => {
    const ix = buildIndex(applied);
    const ids = (q: string) => searchLines(ix, q).map((l) => l.id);
    for (const q of ['801', '802', '850', '860', '875', '885']) expect(ids(q), q).toContain(5000);
    expect(ids('860')).toEqual(expect.arrayContaining([5000, 5004]));
    expect(ids('875')).toEqual(expect.arrayContaining([5000, 5011]));
    for (const q of ['350', '351', '352', '353']) expect(searchLines(ix, q)[0]?.id, q).toBe(2017);
  });
  it('the line page names both numbers and the old one, and the directions carry theirs', () => {
    const l = applied.find((x) => x.id === 2009)!;
    expect(lineNumberLabel(l)).toBe('380 / 381');
    expect(formerNumber(l)).toBe('80');
    expect(l.directions.map((d) => dirLabel(d, l.name))).toEqual(['380 Funchal → Porto Moniz', '381 Porto Moniz → Funchal']);
  });
  it('lines that already have a new number in SIGA\'s index are untouched', () => {
    const l = applied.find((x) => x.number === '503')!;
    expect(l.newNumbers).toBeUndefined();
    expect(lineNumberLabel(l)).toBe('503');
  });
});

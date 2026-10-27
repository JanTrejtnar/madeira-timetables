import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadDataset, type LastGoodStore } from '../src/data';
import { datasetProblem, isDataset, isShape, isViaRoutes } from '../src/lib/validate';

const file = 'public/data/schedules.json';
const tiny = {
  generatedAt: '2026-10-27',
  source: 'test',
  lines: [
    {
      id: 1, number: '1', name: 'One', type: 'urbano', hasParsedSchedule: true, notes: {},
      directions: [{ to: 'B', shapeId: null, stops: [{ code: null, name: 'A', lat: 32.6, lon: -16.9 }, { code: null, name: 'B' }], departures: { weekday: [{ t: '08:00' }] }, trips: [{ days: ['weekday'], times: ['08:00', '08:10'] }] }],
    },
  ],
};
const clone = () => JSON.parse(JSON.stringify(tiny));

describe('datasetProblem', () => {
  it('accepts a well-formed dataset', () => {
    expect(datasetProblem(tiny)).toBeNull();
    expect(isDataset(tiny)).toBe(true);
  });
  it.each([
    ['null', null, /not an object/],
    ['a string (an error page)', '<html>', /not an object/],
    ['no lines', { generatedAt: 'x', lines: [] }, /lines/],
    ['no generatedAt', { lines: tiny.lines }, /generatedAt/],
  ])('rejects %s', (_, data, why) => {
    expect(datasetProblem(data)).toMatch(why);
  });
  it('names the path of a damaged stop, trip or line', () => {
    const noName = clone(); delete noName.lines[0].directions[0].stops[1].name;
    expect(datasetProblem(noName)).toMatch(/^lines\[0\]\.directions\[0\]\.stops\[1\]/);
    const lonly = clone(); delete lonly.lines[0].directions[0].stops[0].lon;
    expect(datasetProblem(lonly)).toMatch(/stops\[0\].*lat \/ lon/);
    const far = clone(); far.lines[0].directions[0].stops[0].lat = 400;
    expect(datasetProblem(far)).toMatch(/position/);
    const shortTrip = clone(); shortTrip.lines[0].directions[0].trips[0].times.pop();
    expect(datasetProblem(shortTrip)).toMatch(/trips\[0\]/);
    const noDirs = clone(); noDirs.lines[0].directions = null;
    expect(datasetProblem(noDirs)).toMatch(/directions/);
    const badType = clone(); badType.lines[0].type = 'tram';
    expect(datasetProblem(badType)).toMatch(/type/);
  });
  it('is not fooled by NaN positions (they come out of JSON as null)', () => {
    const nul = clone(); nul.lines[0].directions[0].stops[0].lat = null;
    expect(datasetProblem(nul)).toMatch(/stops\[0\]/);
  });
  it.skipIf(!existsSync(file))('accepts the real data built by build:data', () => {
    expect(datasetProblem(JSON.parse(readFileSync(file, 'utf8')))).toBeNull();
  });
});

describe('files loaded on demand', () => {
  it('route files are lists of points', () => {
    expect(isShape([[32.6, -16.9], [32.7, -16.8]])).toBe(true);
    expect(isShape([])).toBe(false);
    expect(isShape({ code: 404 })).toBe(false);
    expect(isShape([[1, 'x'], [2, 3]])).toBe(false);
  });
  it('detour files are objects of { a, b, pts }', () => {
    const ok = { 'b|0|42': { a: [1, 2], b: [3, 4], pts: [[1, 2], [3, 4]] } };
    expect(isViaRoutes(ok)).toBe(true);
    expect(isViaRoutes({})).toBe(true);
    expect(isViaRoutes({ x: { a: [1, 2], b: [3, 4], pts: [] } })).toBe(false);
    expect(isViaRoutes([])).toBe(false);
    expect(isViaRoutes('<html>')).toBe(false);
  });
});

describe('loadDataset: last good copy', () => {
  const memory = (initial: string | null = null) => {
    let kept = initial;
    const store: LastGoodStore = { read: async () => kept, write: vi.fn(async (text: string) => { kept = text; }) };
    return { store, get: () => kept };
  };
  const good = JSON.stringify(tiny);
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  it('a valid download is used and remembered', async () => {
    const m = memory();
    const d = await loadDataset(async () => good, m.store);
    expect(d.lines).toHaveLength(1);
    await Promise.resolve();
    expect(m.get()).toBe(good);
  });
  it('a damaged download falls back to the last good copy, and does not overwrite it', async () => {
    const warn = quiet();
    const m = memory(good);
    const d = await loadDataset(async () => good.slice(0, 120), m.store); // truncated
    expect(d.generatedAt).toBe('2026-10-27');
    expect(m.store.write).not.toHaveBeenCalled();
    const html = await loadDataset(async () => '<!doctype html><title>offline</title>', m.store);
    expect(html.lines).toHaveLength(1);
    const wrong = await loadDataset(async () => JSON.stringify({ generatedAt: 'x', lines: [{ id: 1 }] }), m.store);
    expect(wrong.lines[0].number).toBe('1');
    warn.mockRestore();
  });
  it('a failed request (offline) falls back too', async () => {
    const warn = quiet();
    const d = await loadDataset(() => Promise.reject(new TypeError('Failed to fetch')), memory(good).store);
    expect(d.lines).toHaveLength(1);
    warn.mockRestore();
  });
  it('rejects when there is no usable copy at all (first visit), including a damaged stored copy', async () => {
    const warn = quiet();
    await expect(loadDataset(async () => '{', memory().store)).rejects.toThrow();
    await expect(loadDataset(async () => 'nope', memory('also nope').store)).rejects.toThrow();
    warn.mockRestore();
  });
});

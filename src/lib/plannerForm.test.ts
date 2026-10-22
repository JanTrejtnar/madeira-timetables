import { describe, expect, it } from 'vitest';
import { connectionLink, emptyForm, formFromQuery, parseConnectionParam } from './plannerForm';

const base = { ...emptyForm(), from: { text: 'Funchal', key: 'k1' }, to: { text: 'Ponte dos Frades', key: 'k2' } };

describe('connection links', () => {
  it('carry start, destination, day, time and the connection itself', () => {
    const url = new URL(connectionLink(base, { y: 2026, m: 10, d: 23 }, 12 * 60 + 25, 12 * 60 + 30, 2000, 'https://x.test/app/'));
    expect(url.origin + url.pathname).toBe('https://x.test/app/');
    const f = formFromQuery(url.search);
    expect(f.from.text).toBe('Funchal');
    expect(f.to.key).toBe('k2');
    expect(f.date).toBe('2026-10-23');
    expect(f.time).toBe('12:25'); // the leave time (a walk to the stop first), the bus goes at 12:30
    expect(parseConnectionParam(url.searchParams.get('c'))).toEqual({ lineId: 2000, dep: '12:30' });
  });
  it('roll over midnight into the next day', () => {
    const f = formFromQuery(new URL(connectionLink(base, { y: 2026, m: 12, d: 31 }, 24 * 60 + 15, 24 * 60 + 20, 7, 'https://x.test/')).search);
    expect(f.date).toBe('2027-01-01');
    expect(f.time).toBe('00:15');
  });
  it('ignore a malformed connection parameter', () => {
    expect(parseConnectionParam('abc')).toBeNull();
    expect(parseConnectionParam('12.25:99')).toBeNull();
    expect(parseConnectionParam(null)).toBeNull();
  });
});

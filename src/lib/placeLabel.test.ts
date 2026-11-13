import { describe, expect, it } from 'vitest';
import { makeT, LANGS } from '../i18n';
import { normalizePicked, formFromQuery, formToQuery, emptyForm } from './plannerForm';
import { placeLabel, tripLabel } from './placeLabel';
import { parseTrips } from './trips-store';
import type { Key } from '../i18n';

describe('a saved place follows the UI language', () => {
  const group = { text: 'Funchal', key: '@muni:Funchal' };
  it('the "(all stops)" wording is not part of the saved text', () => {
    expect(placeLabel(group, makeT('cs'), 'cs')).toBe('Funchal');
    expect(tripLabel({ from: group, to: { text: 'Camacha', key: 'camacha' } }, makeT('en'), 'en')).toBe('Funchal → Camacha');
  });
  it('"My location" is built from the nearest stop in the current language', () => {
    const here = { text: 'Aeroporto', key: 'aeroporto', here: true as const };
    expect(placeLabel(here, makeT('cs'), 'cs')).toBe('Moje poloha (Letiště)');
    expect(placeLabel(here, makeT('en'), 'en')).toBe('My location (Airport)');
    expect(placeLabel(here, makeT('pt'), 'pt')).toBe('A minha localização (Aeroporto)');
  });
  it('typed text with no suggestion behind it stays as typed', () => {
    expect(placeLabel({ text: 'aeroporto', key: null }, makeT('en'), 'en')).toBe('aeroporto');
  });
});

describe('places saved by older versions (label in the language of that time)', () => {
  it('every language of the "(all stops)" label is reduced to the bare name', () => {
    for (const lang of LANGS) {
      const label = makeT(lang)('allStopsOf' as Key, { name: 'Santana' });
      expect(normalizePicked({ text: label, key: '@par:Santana' }), lang).toEqual({ text: 'Santana', key: '@par:Santana' });
    }
  });
  it('a label typed by the user is left alone (only a picked group has the qualifier stripped)', () => {
    const p = { text: 'Funchal (all stops)', key: null };
    expect(normalizePicked(p)).toBe(p);
  });
  it('"My location (stop)" becomes the stop and the flag', () => {
    for (const lang of LANGS) {
      const label = makeT(lang)('myLocationText' as Key, { name: 'Lido' });
      expect(normalizePicked({ text: label, key: 'lido', pt: { lat: 1, lon: 2 } }), lang).toEqual({ text: 'Lido', key: 'lido', pt: { lat: 1, lon: 2 }, here: true });
    }
  });
  it('localStorage saved in Czech reads back as bare names, so English and Portuguese show no Czech', () => {
    const raw = JSON.stringify([{ from: { text: 'Funchal (všechny zastávky)', key: '@muni:Funchal' }, to: { text: 'Santana (všechny zastávky)', key: '@par:Santana' }, at: 5 }]);
    const [trip] = parseTrips(raw);
    expect(trip!.from.text).toBe('Funchal');
    for (const lang of LANGS) expect(tripLabel(trip!, makeT(lang), lang)).toBe('Funchal → Santana');
  });
  it('an old shared link with the label in the URL is read the same way', () => {
    const f = formFromQuery('?from=Funchal%20(todas%20as%20paragens)&fk=%40muni%3AFunchal&to=Camacha&tk=camacha');
    expect(f.from).toEqual({ text: 'Funchal', key: '@muni:Funchal' });
  });
  it('the flag survives the URL', () => {
    const f = { ...emptyForm(), from: { text: 'Lido', key: 'lido', here: true as const, pt: { lat: 32.64, lon: -16.93 } }, to: { text: 'Camacha', key: 'camacha' } };
    expect(formFromQuery('?' + formToQuery(f)).from).toEqual(f.from);
  });
});

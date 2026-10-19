import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasTranslation, translateNote } from '../src/lib/notes';
import type { Dataset } from '../src/types';

const file = 'public/data/schedules.json';

describe('note translation', () => {
  it('keeps place names and translates the phrases', () => {
    expect(translateNote('Não se realizam viagens a 25 de Dezembro', 'cs')).toBe('25. prosince se nejezdí');
    expect(translateNote('Não se realizam viagens a 25 de Dezembro', 'en')).toBe('No service on 25 December');
    expect(translateNote('Via Largo da Achada e Palheiro Ferreiro', 'cs')).toBe('přes Largo da Achada e Palheiro Ferreiro');
    expect(translateNote('Até/ Dos Lombos (na ida não passa na paragem Largo da Fonte, T-20 (540))', 'cs')).toContain('nezastavuje na zastávce Largo da Fonte');
    expect(translateNote('Inicia nas Lajinhas', 'cs')).toBe('Začíná v Lajinhas');
  });
  it('leaves Portuguese untouched and unknown text as is', () => {
    expect(translateNote('Via Bemposta', 'pt')).toBe('Via Bemposta');
    expect(translateNote('Algo completamente novo', 'cs')).toBe('Algo completamente novo');
  });
  it.skipIf(!existsSync(file))('every note in the shipped data has a translation', () => {
    const data: Dataset = JSON.parse(readFileSync(file, 'utf8'));
    const texts = new Set<string>();
    for (const l of data.lines) {
      Object.values(l.notes ?? {}).forEach((t) => texts.add(t));
      (l.generalNotes ?? []).forEach((t) => texts.add(t));
      Object.values(l.dayLabels ?? {}).forEach((t) => texts.add(t as string));
    }
    const missing = [...texts].filter((t) => t.trim() && !hasTranslation(t));
    expect(missing).toEqual([]);
  });
});

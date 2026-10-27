import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script
import { keyOf } from '../scripts/lib-coords.mjs';
// @ts-expect-error plain .mjs build script
import { cleanName } from '../scripts/lib-text.mjs';

describe('printed abbreviations of the operators are one place with the full name', () => {
  it('keyOf resolves a name that is only an abbreviation', () => {
    for (const n of ['P.Cruz', 'P. Cruz', 'Porto Cruz', 'Porto da Cruz']) expect(keyOf(n)).toBe('porto da cruz');
    expect(keyOf('P.Moniz')).toBe(keyOf('Porto Moniz'));
    expect(keyOf('P. Delgada')).toBe(keyOf('Ponta Delgada'));
    expect(keyOf('P.Pargo')).toBe(keyOf('Ponta do Pargo'));
    expect(keyOf('P.Sol')).toBe(keyOf('Ponta do Sol'));
    expect(keyOf('S.Vicente')).toBe(keyOf('São Vicente'));
    expect(keyOf('S.Jorge')).toBe(keyOf('São Jorge'));
    expect(keyOf('St.Cruz')).toBe(keyOf('Santa Cruz'));
    expect(keyOf('S.Serra')).toBe(keyOf('Santo da Serra'));
    expect(keyOf('STA Quitéria, Frutas')).toBe(keyOf('Santa Quitéria, Frutas'));
  });
  it('a longer name is a different place: the tunnel stop is not the village', () => {
    expect(keyOf('P. Cruz (Túnel)')).not.toBe(keyOf('Porto da Cruz'));
    expect(keyOf('Rª Brava')).not.toBe(keyOf('Ribeira Brava'));
  });
  it('the direction marker is still stripped', () => {
    expect(keyOf('P.Cruz, D')).toBe(keyOf('Porto da Cruz'));
  });
  it('cleanName shows a name that is only an abbreviation under the full name', () => {
    expect(cleanName('P.Cruz')).toBe('Porto da Cruz');
    expect(cleanName('S.Serra')).toBe('Santo da Serra');
    expect(cleanName('P. Cruz (Túnel)')).toBe('P. Cruz (Túnel)');
  });
});

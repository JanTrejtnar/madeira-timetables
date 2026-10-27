import { describe, expect, it } from 'vitest';
import { haversineKm, haversineM, localSq, metres, metresToSegment, norm } from '../shared/geo.mjs';

// Funchal cable-car station and the Sé: ~1 km apart
const a = { lat: 32.6475, lon: -16.907 };
const b = { lat: 32.6505, lon: -16.9115 };

describe('shared/geo', () => {
  it('accepts [lat, lon] pairs and { lat, lon } objects alike', () => {
    expect(haversineKm([a.lat, a.lon], [b.lat, b.lon])).toBe(haversineKm(a, b));
    expect(metres([a.lat, a.lon], b)).toBe(metres(a, b));
  });
  it('the flat distance agrees with the haversine to well under 1 % over a few km', () => {
    for (const [p, q] of [[a, b], [a, { lat: 32.7, lon: -16.85 }], [{ lat: 32.75, lon: -17.1 }, { lat: 32.8, lon: -17.05 }]] as const) {
      const h = haversineM(p, q);
      expect(Math.abs(metres(p, q) - h) / h).toBeLessThan(0.005);
    }
  });
  it('is symmetric and zero for the same point', () => {
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
    expect(metres(a, a)).toBe(0);
    expect(haversineKm(a, b) * 1000).toBe(haversineM(a, b));
  });
  it('distance to a segment: perpendicular foot inside, nearest end outside', () => {
    const p = { lat: 32.65, lon: -16.9 };
    const s1 = { lat: 32.649, lon: -16.9 + 0.001 };
    const s2 = { lat: 32.651, lon: -16.9 + 0.001 };
    expect(metresToSegment(p, s1, s2)).toBeCloseTo(metres(p, { lat: 32.65, lon: -16.899 }), 0);
    expect(metresToSegment(p, s2, { lat: 32.66, lon: -16.899 })).toBeCloseTo(metres(p, s2), 0);
  });
  it('localSq orders candidates like the real distance does near Madeira', () => {
    const p: [number, number] = [32.65, -16.9];
    const near: [number, number] = [32.651, -16.9];
    const far: [number, number] = [32.65, -16.895];
    expect(localSq(p, near) < localSq(p, far)).toBe(metres(p, near) < metres(p, far));
  });
  it('norm: no accents, lower case, punctuation and runs of blanks become one space', () => {
    expect(norm('Câmara de Lobos')).toBe('camara de lobos');
    expect(norm("  S.Vicente – Ribª  Brava, D2 ")).toBe('s vicente rib brava d2');
    expect(norm('Funchal')).toBe('funchal');
  });
});

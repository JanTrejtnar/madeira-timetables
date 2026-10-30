import { describe, expect, it } from 'vitest';
import { connectionFare, type FareLeg } from './fare';

const hf = (at: number): FareLeg => ({ at, zone: 'municipal' });
const inter = (at: number): FareLeg => ({ at, zone: 'intermunicipal' });

describe('connectionFare', () => {
  it('on-board ticket: 2.05 per municipal bus, no transfer', () => {
    expect(connectionFare('none', [hf(600)]).total).toBe(2.05);
    expect(connectionFare('none', [hf(600), hf(610)]).total).toBe(4.1);
  });
  it('on-board ticket: 2.65 per intermunicipal bus', () => {
    expect(connectionFare('none', [inter(600)]).total).toBe(2.65);
  });
  it('giro card: 1.45 for the first municipal bus, the transfer inside the window is free', () => {
    const f = connectionFare('blue', [hf(600), hf(630), hf(645)]);
    expect(f.total).toBe(1.45);
    expect(f.legs.map((l) => l.price)).toEqual([1.45, 0, 0]);
  });
  it('giro card: a municipal bus after the window needs a new ticket', () => {
    expect(connectionFare('blue', [hf(600), hf(646)]).total).toBe(2.9);
  });
  it('giro card: intermunicipal buses share a 90 min window', () => {
    expect(connectionFare('blue', [inter(600), inter(690)]).total).toBe(2.0);
    expect(connectionFare('blue', [inter(600), inter(691)]).total).toBe(4.0);
  });
  it('mixed municipal + intermunicipal: no free transfer, prices add up', () => {
    const f = connectionFare('blue', [hf(600), inter(620)]);
    expect(f.total).toBe(3.45);
    expect(f.mixed).toBe(true);
    expect(connectionFare('none', [hf(600), inter(620)]).total).toBe(4.7);
    // the municipal window runs from the first validation, whatever bus rides in between
    expect(connectionFare('blue', [hf(600), inter(610), hf(640)]).total).toBe(3.45);
    expect(connectionFare('blue', [hf(600), inter(610), hf(650)]).total).toBe(4.9);
  });
  it('yellow card rides free', () => {
    expect(connectionFare('yellow', [hf(600), inter(650)]).total).toBe(0);
  });
});

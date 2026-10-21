import { describe, expect, it } from 'vitest';
import { connectionFare } from './fare';

describe('connectionFare', () => {
  it('cash: 2.65 per bus', () => {
    expect(connectionFare('none', [600])).toBe(2.65);
    expect(connectionFare('none', [600, 650])).toBe(5.3);
  });
  it('blue card: one ticket, the transfer within 90 min is free', () => {
    expect(connectionFare('blue', [600])).toBe(2.05);
    expect(connectionFare('blue', [600, 689])).toBe(2.05);
    expect(connectionFare('blue', [600, 691])).toBe(4.1);
  });
  it('yellow card rides free', () => {
    expect(connectionFare('yellow', [600, 650])).toBe(0);
  });
});

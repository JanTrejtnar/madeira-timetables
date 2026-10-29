import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFoot, FOOT_TIMEOUT_MS } from './foot';
import { TERRAIN_FACTOR, WALK_M_PER_MIN, walkMinutes, walkTo } from './walk';

// two points ~650 m apart; distinct per test so the in-memory cache of foot.ts does not answer
const pair = (n: number) => ({ a: { lat: 32.65 + n * 0.01, lon: -16.9 }, b: { lat: 32.655 + n * 0.01, lon: -16.9 } });

afterEach(() => vi.unstubAllGlobals());

describe('walking route without the routing service', () => {
  it('a failing request (offline, DNS, 5xx) resolves to null, never rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { a, b } = pair(1);
    await expect(fetchFoot(a, b)).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    const q = pair(2);
    await expect(fetchFoot(q.a, q.b)).resolves.toBeNull();
  });

  it('a malformed answer resolves to null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 'NoRoute' }) }));
    const { a, b } = pair(3);
    await expect(fetchFoot(a, b)).resolves.toBeNull();
  });

  it('the service is given up on after 3 s', () => {
    expect(FOOT_TIMEOUT_MS).toBe(3000);
  });

  it('the fallback the callers use is the straight line x 1.3 at about 4 km/h', () => {
    const { a, b } = pair(4);
    const w = walkTo(a, b)!;
    expect(TERRAIN_FACTOR).toBe(1.3);
    expect(WALK_M_PER_MIN * 60).toBeCloseTo(4000, -3); // 4.2 km/h
    expect(w.m).toBeGreaterThan(550 * TERRAIN_FACTOR);
    expect(w.m).toBeLessThan(560 * TERRAIN_FACTOR);
    expect(w.min).toBe(walkMinutes(w.m));
    expect(walkMinutes(w.m)).toBe(Math.ceil(w.m / WALK_M_PER_MIN));
    expect(walkMinutes(0)).toBe(1);
  });
});

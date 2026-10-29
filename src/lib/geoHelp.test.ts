import { describe, expect, it } from 'vitest';
import { detectPlatform, geoDeniedKey } from './geoHelp';

describe('detectPlatform', () => {
  it('recognises iOS, iPadOS posing as a Mac, Android and the rest', () => {
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 })).toBe('ios');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe('desktop');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120', maxTouchPoints: 5 })).toBe('android');
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 })).toBe('desktop');
  });
  it('maps the platform to its hint', () => {
    expect(geoDeniedKey('ios')).toBe('geoDeniedIos');
    expect(geoDeniedKey('android')).toBe('geoDeniedAndroid');
    expect(geoDeniedKey('desktop')).toBe('geoDeniedDesktop');
  });
});

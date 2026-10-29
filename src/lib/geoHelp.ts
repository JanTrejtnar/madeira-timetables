// "Location not allowed": browsers cannot open the OS settings, so the one-sentence message tells where the permission is switched on, by platform.
import type { Key, T } from '../i18n';

export type GeoPlatform = 'ios' | 'android' | 'desktop';

export function detectPlatform(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & { platform?: string } = navigator): GeoPlatform {
  const ua = nav.userAgent ?? '';
  if (/iPhone|iPad|iPod/i.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export const geoDeniedKey = (p: GeoPlatform = detectPlatform()) => (p === 'ios' ? 'geoDeniedIos' : p === 'android' ? 'geoDeniedAndroid' : 'geoDeniedDesktop') satisfies Key;

/** "Location is not allowed. …" with the steps for this device */
export const geoDeniedText = (t: T): string => t(geoDeniedKey());

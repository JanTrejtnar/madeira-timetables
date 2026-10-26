// "Location not allowed": browsers cannot open the OS settings, so the hint tells where the permission is switched on, by platform.
import type { Key, T } from '../i18n';

export type GeoPlatform = 'ios' | 'android' | 'desktop';

export function detectPlatform(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & { platform?: string } = navigator): GeoPlatform {
  const ua = nav.userAgent ?? '';
  if (/iPhone|iPad|iPod/i.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export const geoHelpKey = (p: GeoPlatform = detectPlatform()) => (p === 'ios' ? 'geoHelpIos' : p === 'android' ? 'geoHelpAndroid' : 'geoHelpDesktop') satisfies Key;

/** "Location is not allowed. …" + the steps for this device */
export function geoDeniedText(t: T): string {
  return `${t('geoDenied')} ${t(geoHelpKey())}`;
}

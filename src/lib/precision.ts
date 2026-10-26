import type { Stop } from '../types';

/** A position that is only a guess (village centre, name match, hand placement, interpolation): the exact platform is not verified. */
export const isApproxPosition = (s: Stop): boolean =>
  s.lat !== undefined && s.lon !== undefined && !s.via && (!!s.approx || !!s.isEstimatedLocation || (!!s.locationPrecision && s.locationPrecision !== 'exact'));

export const hasGps = (s: Stop): boolean => s.lat !== undefined && s.lon !== undefined;

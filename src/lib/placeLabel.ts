import type { T } from '../i18n';
import { localStopName } from './text';
import type { Picked } from './plannerForm';

type Lang = 'cs' | 'en' | 'pt';

/** The place of a planner field as a short label in the UI language: the name, or "My location (name)" for a start taken from the device position. */
export function placeLabel(p: Pick<Picked, 'text' | 'key' | 'here'>, t: T, lang: Lang): string {
  // typed text with no suggestion behind it stays as typed
  const name = p.key ? localStopName(p.text, lang) : p.text;
  return p.here ? t('myLocationText', { name }) : name;
}

/** "from → to" of a saved or current search, for the one-line summaries and the share text. */
export const tripLabel = (trip: { from: Picked; to: Picked }, t: T, lang: Lang) => `${placeLabel(trip.from, t, lang)} → ${placeLabel(trip.to, t, lang)}`;

/** Fares of the Madeira buses, by the card the traveller holds. */
export type FareCard = 'none' | 'blue' | 'yellow';

export const FARE_CARDS: FareCard[] = ['none', 'blue', 'yellow'];
/** cash ticket, per bus */
export const CASH_FARE = 2.65;
/** blue giro card, per journey; a transfer within the window is free */
export const BLUE_FARE = 2.05;
export const BLUE_WINDOW_MIN = 90;

/** Price in euro of a connection whose buses board at the given times (minutes), or 0 when it is free. */
export function connectionFare(card: FareCard, boardings: number[]): number {
  if (card === 'yellow' || !boardings.length) return 0;
  if (card === 'none') return +(CASH_FARE * boardings.length).toFixed(2);
  // blue card: a new ticket is needed for a bus that boards more than 90 min after the one that started the current ticket
  let tickets = 0;
  let start = -Infinity;
  for (const b of boardings) {
    if (b - start > BLUE_WINDOW_MIN) {
      tickets++;
      start = b;
    }
  }
  return +(BLUE_FARE * tickets).toFixed(2);
}

export const formatEuro = (v: number, lang: string) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR' }).format(v);

export function isFareCard(v: unknown): v is FareCard {
  return v === 'none' || v === 'blue' || v === 'yellow';
}

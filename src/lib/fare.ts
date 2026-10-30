/**
 * Fares of the Madeira buses, by the card the traveller holds. Source: tariff of Horários do Funchal
 * (https://www.horariosdofunchal.pt/index.php/tarifario/bilhetes, Portaria n.º 128/2026), adult prices.
 *
 * Two tariff zones matter for a connection: the municipal one (the Funchal town lines of Horários do Funchal) and the intermunicipal one
 * (Rodoeste, SAM, CAM). The two are charged separately – a ticket of one never covers a bus of the other, so mixed connections just add up.
 */
export type FareCard = 'none' | 'blue' | 'yellow';

export const FARE_CARDS: FareCard[] = ['none', 'blue', 'yellow'];

type FareZone = 'municipal' | 'intermunicipal';

/** on-board ticket ("bilhete de bordo", no card): one ride, no transfer */
const CASH_FARE: Record<FareZone, number> = { municipal: 2.05, intermunicipal: 2.65 };
/** pre-purchased ride on the giro card ("pré-comprado") */
const BLUE_FARE: Record<FareZone, number> = { municipal: 1.45, intermunicipal: 2.0 };
/**
 * Minutes after the first validation in which further buses are free: municipal only on the same operator (Horários do Funchal),
 * intermunicipal on any operator.
 */
const BLUE_WINDOW_MIN: Record<FareZone, number> = { municipal: 45, intermunicipal: 90 };

/** A bus of the connection as the fare sees it. */
export interface FareLeg {
  /** boarding time in minutes */
  at: number;
  zone: FareZone;
}

interface LegFare {
  /** euro paid when boarding this bus; 0 for a transfer inside the window of a ticket already paid */
  price: number;
  /** a new ticket is bought here (false = the bus is covered by the ticket of an earlier one, or the card rides free) */
  paid: boolean;
}

export interface ConnectionFare {
  total: number;
  legs: LegFare[];
  /** buses of both zones: the tickets are separate and just add up */
  mixed: boolean;
}

const round = (v: number) => +v.toFixed(2);

/** Price of a connection whose buses board as given: per bus and in total. */
export function connectionFare(card: FareCard, legs: FareLeg[]): ConnectionFare {
  const mixed = new Set(legs.map((l) => l.zone)).size > 1;
  if (card === 'yellow') return { total: 0, legs: legs.map(() => ({ price: 0, paid: false })), mixed };
  // blue card: a bus is free when it boards within the window of the ticket that was started by an earlier bus of the same zone
  const start: Record<FareZone, number> = { municipal: -Infinity, intermunicipal: -Infinity };
  const perLeg = legs.map((l): LegFare => {
    if (card === 'none') return { price: CASH_FARE[l.zone], paid: true };
    if (l.at - start[l.zone] <= BLUE_WINDOW_MIN[l.zone]) return { price: 0, paid: false };
    start[l.zone] = l.at;
    return { price: BLUE_FARE[l.zone], paid: true };
  });
  return { total: round(perLeg.reduce((s, l) => s + l.price, 0)), legs: perLeg, mixed };
}

export const formatEuro = (v: number, lang: string) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR' }).format(v);

export function isFareCard(v: unknown): v is FareCard {
  return v === 'none' || v === 'blue' || v === 'yellow';
}

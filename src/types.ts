export type DayKey = 'weekday' | 'saturday' | 'sunday' | 'weekday_school' | 'weekday_holiday';

export interface Departure {
  t: string; // "HH:MM"; times after midnight (e.g. 00:10) follow late-evening ones in the list
  notes?: string[];
}

export interface Stop {
  code: string | null;
  name: string;
  lat?: number;
  lon?: number;
  /** coordinates were not printed with the timetable but matched by name against a stop of another route */
  approx?: boolean;
  /** position interpolated along the route polyline between two stops with known positions (build:data) */
  isEstimatedLocation?: boolean;
}

/** One run of a bus: a time at every stop (null = does not call there). */
export interface Trip {
  days: DayKey[];
  times: (string | null)[];
  notes?: string[];
}

export interface Direction {
  variant: string | null;
  /** Terminal the departures below leave from (as printed in the timetable header). */
  from: string | null;
  to: string;
  shapeId: number | null;
  stopSource: 'shapedata' | 'pdf' | 'none';
  stops: Stop[];
  /** Departures from the first stop (terminal). */
  departures: Partial<Record<DayKey, Departure[]>>;
  /** Times at every stop; only for timetables that print them ("Locais Passagem"). */
  trips?: Trip[];
  /** true: times at stops after the first are estimates (distance / average speed); false: printed in the timetable. */
  isEstimated?: boolean;
  /** Estimated minutes from the first stop and km along the route, one per stop (only when isEstimated). */
  stopOffsets?: number[];
  stopKm?: number[];
  speedKmh?: number;
}

export interface Line {
  id: number;
  number: string;
  newNumber: string | null;
  oldNumber: string;
  name: string;
  route: string;
  municipality: string | null;
  type: 'urbano' | 'interurbano';
  /** same as type === 'interurbano'; set by build:data (also for urban-labelled lines that span municipalities / > 15 km) */
  isInterurbano?: boolean;
  /** why build:data changed the type printed by SIGA */
  typeReason?: string;
  /** the type printed by SIGA when build:data overrode it */
  typeSiga?: 'urbano' | 'interurbano';
  pdfUrl: string;
  pdfLocal?: string;
  jpgUrl: string | null;
  family: string;
  hasParsedSchedule: boolean;
  notes: Record<string, string>;
  generalNotes?: string[];
  dayLabels?: Partial<Record<DayKey, string>>;
  directions: Direction[];
  /** operator outside SIGA (e.g. Horários do Funchal) and where its timetable was read */
  operator?: string;
  sourceUrl?: string;
  /** prices and conditions shown on the line page, per UI language */
  info?: { price?: Record<'cs' | 'en' | 'pt', string>; conditions?: Record<'cs' | 'en' | 'pt', string> };
}

export interface Dataset {
  generatedAt: string;
  source: string;
  lines: Line[];
}

/** One route drawn on the map: the shape polyline (if any) plus its stops. */
export interface MapLayer {
  shapeId: number | null;
  stops: Stop[];
  color: string;
}

/** Stop of the first map layer to centre on and open the popup of, with the passing time of the selected trip. */
export interface MapFocus {
  stopIndex: number;
  /** changes on every tap so the popup re-opens even for the same stop */
  seq: number;
  /** one display string per stop of the layer ("11:18", "~11:18" or null) */
  times: (string | null)[];
}

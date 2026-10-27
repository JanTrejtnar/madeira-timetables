import { useEffect, useMemo } from 'react';
import { useT } from '../../i18n';
import { localStopName } from '../../lib/text';
import { tripStops } from '../../lib/network';
import { useFootRoutes, type FootPair } from '../../lib/foot';
import { detoursFor } from '../../lib/via';
import type { Itinerary } from '../../lib/router';
import type { Picked } from '../../lib/plannerForm';
import type { MapLayer, MapPin as PickedPin } from '../../types';
import { useViaRoutes } from '../../data';
import { metres } from '../../../shared/geo.mjs';
import { badgeText, LEG_COLORS, lineColor, type Shared } from '../common';

type Pt = { lat: number; lon: number };

/**
 * The selected connection drawn on the map (desktop side map, small map on the phone): the bus legs, the pins of the start / destination,
 * the walks along the streets and the changes of bus. On the desktop the layers are also handed to the side map.
 */
export function useConnectionMap(shared: Shared, selected: { it: Itinerary } | undefined, fromPtOf: (it?: Itinerary) => Pt | undefined, toPtOf: (it?: Itinerary) => Pt | undefined): MapLayer[] | null {
  const { t, lang } = useT();
  // walking along the streets for the selected itinerary: from the picked point to the first stop, from the last stop to the picked point, between the platforms of a transfer
  const footPairs: FootPair[] = (() => {
    if (!selected) return [];
    const legs = selected.it.legs;
    const ll = (s: { lat?: number; lon?: number }) => (s.lat !== undefined && s.lon !== undefined ? { lat: s.lat, lon: s.lon } : null);
    const first = ll(tripStops(legs[0].trip)[legs[0].fromPos]);
    const lastLeg = legs[legs.length - 1];
    const lastStop = ll(tripStops(lastLeg.trip)[lastLeg.toPos]);
    const sFrom = fromPtOf(selected.it);
    const sTo = toPtOf(selected.it);
    const pairs: FootPair[] = [sFrom && first ? [sFrom, first] : null, sTo && lastStop ? [lastStop, sTo] : null];
    legs.slice(0, -1).forEach((l, i) => {
      const a = ll(tripStops(l.trip)[l.toPos]);
      const b = ll(tripStops(legs[i + 1].trip)[legs[i + 1].fromPos]);
      pairs.push(a && b && metres(a as Pt, b as Pt) > 5 ? [a, b] : null);
    });
    return pairs;
  })();
  const foot = useFootRoutes(footPairs);
  const selFrom = fromPtOf(selected?.it);
  const selTo = toPtOf(selected?.it);
  const footSig = foot.map((r) => (r ? r.m : '-')).join(',');

  // detour routes of the selected connection's lines (loaded on demand)
  const viaRoutes = useViaRoutes(selected ? selected.it.legs.map((l) => l.trip.line) : []);
  const layers = useMemo<MapLayer[] | null>(() => {
    if (!selected) return null;
    const legs = selected.it.legs;
    // a dash in the timetable (no time) = the trip does not call there: not drawn
    const ridden = (l: (typeof legs)[number]) => tripStops(l.trip).slice(l.fromPos, l.toPos + 1).filter((_, k) => l.trip.times[l.fromPos + k] !== null);
    // A / B always mark the start and the destination: the picked point, else the boarding / alighting stop itself (no walk to draw then)
    const pinFor = (kind: PickedPin['kind'], pt: Picked['pt'], stop: { lat?: number; lon?: number; name: string }, path?: [number, number][]): PickedPin | null => {
      const at = pt ?? (stop.lat !== undefined && stop.lon !== undefined ? { lat: stop.lat, lon: stop.lon } : null);
      if (!at) return null;
      return { kind, label: t(kind === 'from' ? 'mapStart' : 'mapEnd'), lat: at.lat, lon: at.lon, stop: stop.lat !== undefined && stop.lon !== undefined ? { lat: stop.lat, lon: stop.lon, name: stop.name } : undefined, ...(pt && path ? { path } : {}) };
    };
    const first = tripStops(legs[0].trip)[legs[0].fromPos];
    const lastLeg = legs[legs.length - 1];
    const pins = [pinFor('from', selFrom, first, foot[0]?.pts), pinFor('to', selTo, tripStops(lastLeg.trip)[lastLeg.toPos], foot[1]?.pts)].filter((p): p is PickedPin => p !== null);
    // every change of bus: the alighting stop, and the walk to the platform of the next bus when that is another stop
    const transfers = legs.slice(0, -1).flatMap((l, i) => {
      const a = tripStops(l.trip)[l.toPos];
      const b = tripStops(legs[i + 1].trip)[legs[i + 1].fromPos];
      if (a.lat === undefined || a.lon === undefined) return [];
      const at: [number, number] = [a.lat, a.lon];
      const apart = b.lat !== undefined && b.lon !== undefined && metres(a as Pt, b as Pt) > 5;
      return [{ name: a.name, at, ...(apart ? { to: [b.lat, b.lon] as [number, number] } : {}), ...(apart && foot[2 + i] ? { path: foot[2 + i]!.pts } : {}) }];
    });
    return legs.map((l, i) => ({
      shapeId: l.trip.dir.shapeId,
      // a dash in the timetable (no time) = the trip does not call there: not drawn
      stops: ridden(l),
      // with a transfer every bus gets its own colour and a place in the legend
      color: legs.length > 1 ? LEG_COLORS[i % LEG_COLORS.length] : lineColor(l.trip.line),
      ...(legs.length > 1 ? { legend: { badge: badgeText(l.trip.line), text: `${localStopName(tripStops(l.trip)[l.fromPos].name, lang)} → ${localStopName(tripStops(l.trip)[l.toPos].name, lang)}` } } : {}),
      detours: detoursFor(viaRoutes.get(l.trip.line.id), l.trip.dirIndex, l.trip.notes),
      trip: { stops: tripStops(l.trip).flatMap((s, k) => (s.lat !== undefined && s.lon !== undefined ? [{ at: [s.lat, s.lon] as [number, number], calls: l.trip.times[k] !== null }] : [])) },
      served: { from: 0, to: Math.max(0, ridden(l).length - 1) },
      ride: { stops: tripStops(l.trip).map((s) => (s.lat !== undefined && s.lon !== undefined ? ([s.lat, s.lon] as [number, number]) : null)), from: l.fromPos, to: l.toPos },
      ...(i === 0 && pins.length ? { pins } : {}),
      ...(i === 0 && transfers.length ? { transfers } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selFrom, selTo, footSig, t, lang, viaRoutes]);
  const { desktop, setMap } = shared;
  useEffect(() => {
    if (!desktop) return;
    setMap(layers);
    return () => setMap(null);
  }, [desktop, setMap, layers]);
  return layers;
}

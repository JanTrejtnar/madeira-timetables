// "Stops near me": nodes of the network within a radius of a GPS position, and the next departures from one of them.
import type { Line } from '../types';
import { dirKey, type Network } from './network';
import { nextAtStop, nextDepartures, type Ctx, type Upcoming } from './departures';
import { toMinutes } from './time';
import { haversineM } from '../../shared/geo.mjs';

export interface UserPos {
  lat: number;
  lon: number;
  /** accuracy in metres */
  acc: number;
  /** changes on every fix so the map re-centres even for the same coordinates */
  seq: number;
}

export interface NearbyStop {
  nodeId: number;
  key: string;
  name: string;
  lat: number;
  lon: number;
  /** metres from the user */
  dist: number;
}

/** Great-circle distance in metres. */
export const distanceM: (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => number = haversineM;

export const NEAR_M = 500;
export const FAR_M = 1000;

/** Stops within 500 m; if there are fewer than three, within 1 km. Sorted by distance. `widened` tells the radius grew. */
export function nearbyStops(net: Network, pos: UserPos, limit = 12): { stops: NearbyStop[]; widened: boolean } {
  const all: NearbyStop[] = [];
  for (const n of net.nodes) {
    if (n.lat === undefined || n.lon === undefined) continue;
    const dist = distanceM(pos, { lat: n.lat, lon: n.lon });
    if (dist <= FAR_M) all.push({ nodeId: n.id, key: n.key, name: n.name, lat: n.lat, lon: n.lon, dist });
  }
  all.sort((a, b) => a.dist - b.dist);
  // the two sides of a road are separate nodes; keep the nearer one per name
  const seen = new Set<string>();
  const unique = all.filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true)));
  const near = unique.filter((s) => s.dist <= NEAR_M);
  const widened = near.length < 3 && unique.length > near.length;
  return { stops: (widened ? unique : near).slice(0, limit), widened };
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export interface StopDeparture {
  line: Line;
  dirIndex: number;
  next: Upcoming;
  /** time is an estimate (distance / average speed), not printed */
  estimated: boolean;
}

/** Soonest departures from a stop over all lines that call there (not at the last stop of a direction). */
export function departuresFrom(net: Network, lines: Line[], keyOrNode: { nodeId: number; key: string }, ctx: Ctx, limit = 6): StopDeparture[] {
  const ids = new Set(net.keyToNodes.get(keyOrNode.key) ?? [keyOrNode.nodeId]);
  const out: StopDeparture[] = [];
  for (const line of lines) {
    line.directions.forEach((dir, di) => {
      const nodes = net.dirNodes.get(dirKey(line, di)) ?? [];
      const idx = nodes.findIndex((id) => ids.has(id));
      if (idx < 0 || idx === nodes.length - 1) return;
      if (dir.trips?.length) {
        for (const next of nextAtStop(dir, idx, ctx, 1)) out.push({ line, dirIndex: di, next, estimated: false });
      } else if (dir.isEstimated && dir.stopOffsets) {
        const off = dir.stopOffsets[idx] ?? 0;
        for (const u of nextDepartures(dir, ctx, 1)) {
          out.push({ line, dirIndex: di, next: idx ? { ...u, t: hhmm((toMinutes(u.t) + off) % 1440), inMin: u.inMin + off } : u, estimated: idx > 0 });
        }
      }
    });
  }
  return out.sort((a, b) => a.next.inMin - b.next.inMin).slice(0, limit);
}

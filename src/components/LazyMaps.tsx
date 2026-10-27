// The map components (and Leaflet with its stylesheet) are loaded when a map is first shown, not with the first screen:
// the start page is the text planner, and the JavaScript the phone has to parse before it can be used is that much smaller.
// The chunks are precached by the service worker, so the maps still open offline.
import { lazy, Suspense, type ComponentProps } from 'react';
import { Skeleton } from './common';

const RouteMapChunk = lazy(() => import('./RouteMap').then((m) => ({ default: m.RouteMap })));
const NetworkMapChunk = lazy(() => import('./NetworkMap').then((m) => ({ default: m.NetworkMap })));
const MapPickerChunk = lazy(() => import('./MapPicker').then((m) => ({ default: m.MapPicker })));

/** Same footprint as the map it stands in for (a card, or the whole parent), so the page does not jump when the map arrives. */
const Placeholder = ({ fill }: { fill?: boolean }) => (
  <div className={fill ? 'h-full w-full' : 'h-72 w-full'} role="status" aria-busy="true">
    <Skeleton className={`h-full w-full ${fill ? 'rounded-none' : 'rounded-2xl'}`} />
  </div>
);

export function RouteMap(props: ComponentProps<typeof RouteMapChunk>) {
  return (
    <Suspense fallback={<Placeholder fill={props.fill} />}>
      <RouteMapChunk {...props} />
    </Suspense>
  );
}

export function NetworkMap(props: ComponentProps<typeof NetworkMapChunk>) {
  return (
    <Suspense fallback={<Placeholder fill={props.fill} />}>
      <NetworkMapChunk {...props} />
    </Suspense>
  );
}

export function MapPicker(props: ComponentProps<typeof MapPickerChunk>) {
  return (
    <Suspense fallback={<div className="fixed inset-0 z-1000 bg-white dark:bg-slate-950" role="status" aria-busy="true"><Placeholder fill /></div>}>
      <MapPickerChunk {...props} />
    </Suspense>
  );
}

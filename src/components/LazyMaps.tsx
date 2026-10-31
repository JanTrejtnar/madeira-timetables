// The map components (and Leaflet with its stylesheet) are loaded when a map is first shown, not with the first screen:
// the start page is the text planner, and the JavaScript the phone has to parse before it can be used is that much smaller.
// The chunks are precached by the service worker, so the maps still open offline.
import { lazy, Suspense, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react';
import { useT } from '../i18n';
import { ErrorBoundary } from './ErrorBoundary';
import { Skeleton } from './common';

/** A `lazy` component whose rejected import is not cached for good: `reset` makes the next render import it again (retry after a failed chunk load). */
function retryable<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let Comp = lazy(load);
  return { get: () => Comp, reset: () => void (Comp = lazy(load)) };
}

const routeMap = retryable<ComponentProps<typeof import('./RouteMap').RouteMap>>(() => import('./RouteMap').then((m) => ({ default: m.RouteMap })));
const networkMap = retryable<ComponentProps<typeof import('./NetworkMap').NetworkMap>>(() => import('./NetworkMap').then((m) => ({ default: m.NetworkMap })));
const mapPicker = retryable<ComponentProps<typeof import('./MapPicker').MapPicker>>(() => import('./MapPicker').then((m) => ({ default: m.MapPicker })));

/** Same footprint as the map it stands in for (a card, or the whole parent), so the page does not jump when the map arrives. */
const Placeholder = ({ fill }: { fill?: boolean }) => {
  const { t } = useT();
  return (
    <div className={fill ? 'h-full w-full' : 'h-72 w-full'} role="status" aria-busy="true">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className={`h-full w-full ${fill ? 'rounded-none' : 'rounded-2xl'}`} />
    </div>
  );
};

/** Suspense for the loading state, an inline boundary with a retry for a chunk that cannot be fetched (offline and never cached). */
function Lazy<P extends object>({ holder, props, fill, fallback }: { holder: ReturnType<typeof retryable<P>>; props: P; fill?: boolean; fallback?: ReactNode }) {
  const { t } = useT();
  const [, bump] = useState(0);
  const Chunk = holder.get() as ComponentType<P>;
  return (
    <ErrorBoundary
      variant="inline"
      message={t('mapLoadFailed')}
      onRetry={() => {
        holder.reset();
        bump((n) => n + 1);
      }}
    >
      <Suspense fallback={fallback ?? <Placeholder fill={fill} />}>
        <Chunk {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

export function RouteMap(props: ComponentProps<typeof import('./RouteMap').RouteMap>) {
  return <Lazy holder={routeMap} props={props} fill={props.fill} />;
}

export function NetworkMap(props: ComponentProps<typeof import('./NetworkMap').NetworkMap>) {
  return <Lazy holder={networkMap} props={props} fill={props.fill} />;
}

export function MapPicker(props: ComponentProps<typeof import('./MapPicker').MapPicker>) {
  return (
    <Lazy
      holder={mapPicker}
      props={props}
      fallback={
        <div className="fixed inset-0 z-1000 bg-white dark:bg-slate-950">
          <Placeholder fill />
        </div>
      }
    />
  );
}

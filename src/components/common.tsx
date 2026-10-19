import { useState, type ReactNode } from 'react';
import { assetUrl } from '../data';
import { useT } from '../i18n';
import type { Network } from '../lib/network';
import type { Upcoming } from '../lib/departures';
import type { Ctx } from '../lib/departures';
import { googleMapsUrl, mapyCzUrl } from '../lib/maps';
import type { Direction, Line, MapLayer, Stop } from '../types';
import { Icon, type IconName } from './Icons';

export interface Shared {
  ctx: Ctx;
  lines: Line[];
  net: Network;
  openLine: (id: number, dirIndex?: number) => void;
  /** true when the side-by-side layout with the big map is active */
  desktop: boolean;
  /** shows routes on the big desktop map (null clears it) */
  setMap: (layers: MapLayer[] | null) => void;
}

/** Colour of a line on maps and timelines: green = urbano, slate = interurbano. */
export const lineColor = (line: Line) => (line.type === 'urbano' ? '#059669' : '#334155');
export const lineRailCls = (line: Line) => (line.type === 'urbano' ? 'bg-emerald-600' : 'bg-slate-700 dark:bg-slate-400');

export function LineBadge({ line, large = false }: { line: Line; large?: boolean }) {
  const urban = line.type === 'urbano';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-bold tabular-nums tracking-tight text-white ${
        large ? 'h-10 min-w-14 px-3 text-xl' : 'h-7 min-w-11 px-2 text-sm'
      } ${urban ? 'bg-emerald-700' : 'bg-slate-800 dark:bg-slate-600'}`}
    >
      {line.number}
    </span>
  );
}

/** Estimated time (`~14:23`): a quiet amber pill so it stays recognisable without shouting. */
export function EstTag({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-px font-medium text-amber-700 ring-1 ring-inset ring-amber-200/80 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20"
    >
      {children}
    </span>
  );
}

export function dirLabel(dir: Direction, fallback: string): string {
  if (dir.from && dir.to) return `${dir.from} → ${dir.to}`;
  return dir.to || dir.from || fallback;
}

export function PdfButton({ line, big = false }: { line: Line; big?: boolean }) {
  const { t } = useT();
  const href = line.pdfLocal ? assetUrl(line.pdfLocal) : line.pdfUrl;
  return (
    <div className="flex flex-col gap-1.5">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors ${
          big
            ? 'min-h-12 bg-sky-600 px-5 text-white hover:bg-sky-700 active:bg-sky-700'
            : 'min-h-11 border border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
        }`}
      >
        <Icon name="file" className="size-4" />
        {t('showPdf')}
      </a>
      {line.pdfLocal && (
        <a href={line.pdfUrl} target="_blank" rel="noreferrer" className="px-1 text-xs text-slate-500 underline-offset-2 hover:underline">
          {t('openOriginal')}
        </a>
      )}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200/70 bg-white p-4 dark:border-slate-700/70 dark:bg-slate-900 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{children}</h2>
      {aside}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, autoFocus = false }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <label className="relative block">
      <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        className="h-12 w-full rounded-2xl border border-slate-200/70 bg-white pl-11 pr-4 text-base outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15 dark:border-slate-700/70 dark:bg-slate-900"
      />
    </label>
  );
}

/** Pill-shaped toggle button used for day / direction / time chips. */
export function Chip({ active, onClick, children, className = '' }: { active?: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-sky-600 text-white'
          : 'border border-slate-200/70 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700/70 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-800 ${className}`} />;
}

/** Placeholder for a list row / itinerary while data or results are being prepared. */
export function SkeletonCards({ n = 3, tall = false }: { n?: number; tall?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5" role="status" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <Card key={i} className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-11" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          {tall && (
            <div className="space-y-2.5 pl-1">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3.5 w-3/5" />
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, tone = 'neutral' }: { icon: IconName; title: string; body?: string; tone?: 'neutral' | 'warn' }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span
        className={`flex size-16 items-center justify-center rounded-full ${
          tone === 'warn' ? 'bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-300' : 'bg-sky-50 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300'
        }`}
      >
        <Icon name={icon} className="size-8" strokeWidth={1.5} />
      </span>
      <p className="text-base font-semibold">{title}</p>
      {body && <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">{body}</p>}
    </div>
  );
}

export function relative(u: Upcoming, t: ReturnType<typeof useT>['t']): string {
  if (u.dayOffset === 1) return t('tomorrow');
  if (u.inMin <= 0) return t('now');
  if (u.inMin >= 120) return `${Math.floor(u.inMin / 60)} h ${u.inMin % 60} min`;
  return t('inMin', { n: u.inMin });
}

export function Times({ list, t }: { list: Upcoming[]; t: ReturnType<typeof useT>['t'] }) {
  if (!list.length) return <span className="text-sm text-slate-500">{t('noDeparturesToday')}</span>;
  const [first, ...rest] = list;
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">
          {first.t}
          {first.notes?.length ? <sup className="ml-0.5 text-xs font-normal text-slate-500">{first.notes.join(',')}</sup> : null}
        </span>
        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-400/10 dark:text-sky-300">{relative(first, t)}</span>
      </span>
      {rest.map((u, i) => (
        <span key={i} className="text-sm tabular-nums text-slate-500 dark:text-slate-400">
          {u.t}
          {u.notes?.length ? <sup className="ml-0.5 text-xs">{u.notes.join(',')}</sup> : null}
        </span>
      ))}
    </span>
  );
}

const linkCls =
  'inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-800 dark:text-sky-300 dark:hover:bg-slate-700';

/** Micro-buttons that open a stop in Google Maps / Mapy.cz. Without coordinates only a Google name search is offered. */
export function MapLinks({ stop }: { stop: Stop }) {
  const { t } = useT();
  const mapy = mapyCzUrl(stop);
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <a href={googleMapsUrl(stop)} target="_blank" rel="noopener noreferrer" className={linkCls}>
        <Icon name="pin" className="size-3.5" strokeWidth={2} />
        {t('mapGoogle')}
      </a>
      {mapy && (
        <a href={mapy} target="_blank" rel="noopener noreferrer" className={linkCls}>
          <Icon name="map" className="size-3.5" strokeWidth={2} />
          {t('mapMapyCz')}
        </a>
      )}
    </span>
  );
}

/** Small pin button that toggles the {@link MapLinks} of a stop. */
export function MapPin({ stop }: { stop: Stop }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-label={`${t('openInMaps')}: ${stop.name}`}
        title={t('openInMaps')}
        className={`inline-flex size-8 items-center justify-center rounded-full transition-colors ${
          open ? 'bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800'
        }`}
      >
        <Icon name="pin" className="size-4" />
      </button>
      {open && (
        <span onClick={(e) => e.stopPropagation()}>
          <MapLinks stop={stop} />
        </span>
      )}
    </span>
  );
}

export type LineTypeFilter = 'all' | 'interurbano' | 'urbano';

export const matchesType = (line: Line, f: LineTypeFilter) => f === 'all' || line.type === f;

/** Segmented switch: all / intercity (interurbano) / urban (urbano). */
export function TypeFilter({ value, onChange, className = '' }: { value: LineTypeFilter; onChange: (v: LineTypeFilter) => void; className?: string }) {
  const { t } = useT();
  const items: [LineTypeFilter, string][] = [
    ['all', t('typeAll')],
    ['interurbano', t('typeInter')],
    ['urbano', t('typeUrban')],
  ];
  return (
    <div className={`inline-flex rounded-full bg-slate-100 p-0.5 dark:bg-slate-800 ${className}`} role="group" aria-label={t('lines')}>
      {items.map(([k, label]) => (
        <button
          key={k}
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={`h-9 rounded-full px-3.5 text-sm font-medium transition-colors ${
            value === k ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

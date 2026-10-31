import { useT } from '../i18n';
import { plainPlace } from '../lib/text';
import { sameTrip, type SavedTrip } from '../lib/trips-store';
import { Icon } from './Icons';
import type { Shared } from './common';

const label = (trip: Pick<SavedTrip, 'from' | 'to'>, suffix: string, lang: Parameters<typeof plainPlace>[2]) => `${plainPlace(trip.from.text, suffix, lang)} → ${plainPlace(trip.to.text, suffix, lang)}`;

/** Quick access under the planner form: starred connections and the last searches, one tap to search them again. */
export function TripShortcuts({ shared }: { shared: Shared }) {
  const { t, lang } = useT();
  const { favorites, recent } = shared;
  // "(all stops)" is noise in a one-line summary of a trip
  const suffix = t('allStopsOf', { name: '' }).trim();
  if (!favorites.length && !recent.length) return null;
  return (
    <section className="flex flex-col gap-3" data-testid="trip-shortcuts">
      {favorites.length > 0 && (
        <div data-testid="favorites">
          <h2 className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Icon name="star" className="size-3.5 fill-amber-400 text-amber-500" />
            {t('favoritesTitle')}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {favorites.map((f, i) => (
              <li key={`${f.from.text}>${f.to.text}>${i}`} className="flex items-center rounded-xl border border-slate-200/70 bg-white pl-3 dark:border-slate-700/70 dark:bg-slate-900">
                <button type="button" onClick={() => shared.useTrip(f)} className="min-h-11 min-w-0 flex-1 py-2 text-left text-sm font-medium wrap-break-word" data-testid="favorite-trip">
                  {label(f, suffix, lang)}
                </button>
                <button type="button" onClick={() => shared.toggleFavorite(f)} aria-label={`${t('removeFavorite')}: ${label(f, suffix, lang)}`} title={t('removeFavorite')} className="flex size-10 shrink-0 items-center justify-center text-slate-400 hover:text-red-600">
                  <Icon name="close" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recent.length > 0 && (
        <div data-testid="recent">
          <h2 className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Icon name="clock" className="size-3.5" />
            {t('recentTitle')}
            <button type="button" onClick={shared.clearRecent} className="ml-auto min-h-8 rounded-md px-1.5 font-medium normal-case tracking-normal text-sky-700 underline dark:text-sky-300">
              {t('clearRecent')}
            </button>
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {recent.map((r, i) => (
              <li key={`${r.from.text}>${r.to.text}>${i}`} className="flex max-w-full items-center rounded-2xl border border-slate-200/70 bg-white dark:border-slate-700/70 dark:bg-slate-900">
                <button type="button" onClick={() => shared.useTrip(r)} className="inline-flex min-h-11 min-w-0 items-center gap-1.5 py-1.5 pl-3 pr-1 text-left text-sm" data-testid="recent-trip">
                  <Icon name="clock" className="size-3.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 wrap-break-word">{label(r, suffix, lang)}</span>
                </button>
                {(() => {
                  const starred = favorites.some((f) => sameTrip(f, r));
                  return (
                    <button
                      type="button"
                      onClick={() => shared.toggleFavorite(r)}
                      aria-pressed={starred}
                      aria-label={`${starred ? t('removeFavorite') : t('addFavorite')}: ${label(r, suffix, lang)}`}
                      title={starred ? t('removeFavorite') : t('addFavorite')}
                      data-testid="recent-star"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-amber-500"
                    >
                      <Icon name="star" className={`size-4 ${starred ? 'fill-amber-400 text-amber-500' : ''}`} />
                    </button>
                  );
                })()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

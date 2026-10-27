import { useT } from '../../i18n';
import { plainPlace } from '../../lib/text';
import { OPERATORS } from '../../lib/operators';
import type { Shared } from '../common';
import { shortDate } from '../Connection';
import { Icon } from '../Icons';
import type { PlannerState } from './usePlanner';

/** The sticky bar above the results: "from → to", the day and filters of the search, back to the form, favourite. */
export function SearchSummary({ shared, p }: { shared: Shared; p: PlannerState }) {
  const { t, lang } = useT();
  const { time, ops, directOnly, type } = shared.planner;
  const { dFrom, dTo, date, dateIso, todayIso, starred } = p;
  // the "(all stops)" qualifier is noise in a one-line summary
  const plain = (text: string) => plainPlace(text, t('allStopsOf', { name: '' }).trim(), lang);
  return (
    <div className="sticky top-(--header-h,0px) z-30 -mx-4 -mt-4 bg-slate-50/95 px-4 pb-3 pt-2.5 backdrop-blur dark:bg-slate-950/95 lg:-top-4">
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white p-2 pr-3 dark:border-slate-700/70 dark:bg-slate-900" data-testid="search-summary">
        <button
          type="button"
          onClick={() => shared.setPlannerView('form')}
          aria-label={t('editSearch')}
          title={t('editSearch')}
          data-testid="edit-search"
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-sky-700 transition-colors hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-400/10"
        >
          <Icon name="back" className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold wrap-break-word">
            {plain(dFrom.text)} → {plain(dTo.text)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {time === null ? t('departNow') : `${dateIso === todayIso ? t('whenToday') : shortDate(date, lang)} ${time}`}
            {type !== 'all' && ` · ${type === 'urbano' ? t('typeUrbanCity') : t('typeInter')}`}
            {ops.length > 0 && ` · ${ops.map((id) => OPERATORS.find((o) => o.id === id)?.name).join(', ')}`}
            {directOnly && ` · ${t('directShort')}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => shared.toggleFavorite({ from: dFrom, to: dTo })}
          aria-pressed={starred}
          aria-label={starred ? t('removeFavorite') : t('addFavorite')}
          title={starred ? t('removeFavorite') : t('addFavorite')}
          data-testid="favorite-toggle"
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-amber-500"
        >
          <Icon name="star" className={`size-5 ${starred ? 'fill-amber-400 text-amber-500' : ''}`} />
        </button>
      </div>
    </div>
  );
}

import { useT } from '../../i18n';
import type { Picked } from '../../lib/plannerForm';
import { Card, type Shared } from '../common';
import { Icon } from '../Icons';
import { DepartPicker } from '../Pickers';
import { AdvancedSearch } from './AdvancedSearch';
import { Combobox } from './Combobox';
import type { PlannerState } from './usePlanner';

/** The search card: start and destination fields (swap, favourite), the departure time and day, the advanced filters and the search button. */
export function SearchForm({
  shared,
  p,
  setFrom,
  setTo,
  onPickMap,
  locNote,
  onLocate,
  locating,
}: {
  shared: Shared;
  p: PlannerState;
  setFrom: (v: Picked) => void;
  setTo: (v: Picked) => void;
  onPickMap: (kind: 'from' | 'to') => void;
  locNote: string | null;
  onLocate: () => void;
  locating: boolean;
}) {
  const { t } = useT();
  const { planner, commit } = shared;
  const { from, to, time, ops, directOnly, type } = planner;
  const { patch, dayInfo, dFrom, dTo, starred } = p;
  return (
    <Card className="flex flex-col gap-3 p-3!">
      <div className="flex items-stretch gap-2">
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => {
              patch({ from: to, to: from });
              commit({ from: to, to: from });
            }}
            aria-label={t('swap')}
            title={t('swap')}
            data-testid="swap-button"
            className="size-10 shrink-0 rounded-full text-slate-500 transition-colors hover:bg-slate-50 hover:text-sky-600 dark:hover:bg-slate-800"
          >
            <Icon name="swap" className="mx-auto size-5" />
          </button>
        </div>
        <div className="flex w-5 shrink-0 flex-col items-center pb-3.5 pt-4.25">
          <span className="size-2.5 rounded-full border-[2.5px] border-sky-600" />
          <span className="my-1 w-0 flex-1 border-l-2 border-dotted border-slate-300 dark:border-slate-600" />
          <Icon name="pin" className="size-4 text-sky-600" strokeWidth={2} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <Combobox label={t('from')} placeholder={t('fromPlaceholderPlace')} value={from} onChange={setFrom} onCommit={() => commit({ from })} shared={shared} onPickMap={() => onPickMap('from')} onLocate={onLocate} locating={locating} />
          {locNote && (
            <p className="px-2 pb-1 text-xs text-slate-500 dark:text-slate-400" data-testid="location-note" aria-live="polite">
              {locNote}
            </p>
          )}
          <div className="mx-2 h-px bg-slate-100 dark:bg-slate-800" />
          <Combobox label={t('to')} placeholder={t('toPlaceholderPlace')} value={to} onChange={setTo} onCommit={() => commit({ to })} shared={shared} onPickMap={() => onPickMap('to')} />
        </div>
        <div className="flex shrink-0 flex-col items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={() => shared.toggleFavorite({ from: dFrom, to: dTo })}
            disabled={!dFrom.text.trim() || !dTo.text.trim()}
            aria-pressed={starred}
            aria-label={starred ? t('removeFavorite') : t('addFavorite')}
            title={starred ? t('removeFavorite') : t('addFavorite')}
            data-testid="favorite-toggle"
            className="size-10 shrink-0 rounded-full border border-slate-200 text-slate-400 transition-colors hover:bg-slate-50 hover:text-amber-500 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <Icon name="star" className={`mx-auto size-5 ${starred ? 'fill-amber-400 text-amber-500' : ''}`} />
          </button>
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
        <DepartPicker
          time={time}
          date={planner.date}
          today={p.today}
          nowMinutes={shared.ctx.now.minutes}
          note={`${dayInfo.type === null ? t('noService') : t(`day_${dayInfo.type}`)}${dayInfo.reason === 'holiday' ? ` · ${t('reason_holiday')}: ${dayInfo.holiday?.name}` : dayInfo.reason === 'saturday-rule' ? ` · ${dayInfo.special}` : dayInfo.holiday ? ` · ${dayInfo.holiday.name}` : ''}`}
          onChange={(v) => patch(v)}
        />
      </div>
      <AdvancedSearch ops={ops} directOnly={directOnly} type={type} onOps={(v) => patch({ ops: v })} onDirect={(v) => patch({ directOnly: v })} onType={(v) => patch({ type: v })} />
      <button
        type="button"
        onClick={p.startSearch}
        disabled={!from.text.trim() || !to.text.trim()}
        data-testid="search-button"
        className="h-12 w-full rounded-xl bg-sky-600 text-base font-semibold text-white transition-colors hover:bg-sky-700 active:bg-sky-800 disabled:opacity-40"
      >
        {t('searchButton')}
      </button>
    </Card>
  );
}

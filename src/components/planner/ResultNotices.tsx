import { useT } from '../../i18n';
import { FAR_PLACE_M, NEAR_PLACE_M } from '../../lib/network';
import type { SearchResult } from '../../lib/plannerSearch';
import { Chip, EmptyState, EstTag, type Shared } from '../common';

/** What the results page says when there is nothing to list: no stop found, a far place, no connection (with a way out of the filters). */
export function ResultNotices({ shared, searched, result, empty, onResetFilters }: { shared: Shared; searched: boolean; result: SearchResult | null; empty: boolean; onResetFilters: () => void }) {
  const { t } = useT();
  const { ops, directOnly, type } = shared.planner;
  return (
    <>
      {searched && !result && <EmptyState icon="route" title={t('plannerEmptyTitle')} body={t('plannerHint')} />}
      {result && (result.A === 0 || result.B === 0) && <EmptyState icon="alert" tone="warn" title={t('noStopNodesTitle')} body={result.missing ? t('placeNoStop', { place: result.missing, m: FAR_PLACE_M }) : t('noStopNodes')} />}
      {result?.far && result.A > 0 && result.B > 0 && (
        <p className="px-1 text-sm text-amber-700 dark:text-amber-300" data-testid="place-far">
          {t('placeFar', { place: result.far, m: NEAR_PLACE_M })}
        </p>
      )}
      {result && empty && result.A > 0 && result.B > 0 && <EmptyState icon="frown" title={t('noConnectionTitle')} body={t('noConnectionBody')} />}
      {result && empty && result.A > 0 && result.B > 0 && (ops.length > 0 || directOnly || type !== 'all') && (
        <div className="flex justify-center">
          <Chip onClick={onResetFilters}>{t('tryAllTypes')}</Chip>
        </div>
      )}
    </>
  );
}

/** "~ = estimated time" legend under a list that has estimated times. */
export function EstimatedNote() {
  const { t } = useT();
  return (
    <p className="flex items-start gap-2 px-1 text-xs text-slate-500">
      <EstTag>~</EstTag>
      <span>{t('estimatedLegend').replace(/^~ = /, '')}</span>
    </p>
  );
}

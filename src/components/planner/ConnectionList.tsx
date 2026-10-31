import { useT } from '../../i18n';
import { ConnectionCard } from '../Connection';
import type { Shared } from '../common';
import { StepButton } from './StepButton';
import type { PlannerState } from './usePlanner';

/** The found connections in time order, with "earlier" above and "later" below. */
export function ConnectionList({ shared, p }: { shared: Shared; p: PlannerState }) {
  const { t } = useT();
  const { all, date, selected, spent } = p;
  if (!all.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <StepButton onClick={p.earlier} spent={!!spent.early} busy={p.paging === 'early'} label={t('earlierConnections')} spentLabel={t('noEarlier')} testid="earlier-connections" />
      {all.map(({ key: k, it }) => (
        <ConnectionCard key={k} it={it} shared={shared} base={date} selected={selected?.key === k} onOpen={() => p.openConnection(k)} fromPt={p.fromPtOf(it)} toPt={p.toPtOf(it)} />
      ))}
      <StepButton onClick={p.later} spent={!!spent.late} busy={p.paging === 'late'} label={t('laterConnections')} spentLabel={t('noLater')} testid="later-connections" />
    </div>
  );
}

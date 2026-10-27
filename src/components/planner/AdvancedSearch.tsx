import { useState } from 'react';
import { useT } from '../../i18n';
import { OPERATORS, type OperatorId } from '../../lib/operators';
import { TypeFilter, type LineTypeFilter } from '../common';
import { Icon } from '../Icons';

/** "Advanced search": collapsed by default; the operators to travel with (none ticked = all) and direct connections only. */
export function AdvancedSearch({ ops, directOnly, type, onOps, onDirect, onType }: { ops: OperatorId[]; directOnly: boolean; type: LineTypeFilter; onOps: (v: OperatorId[]) => void; onDirect: (v: boolean) => void; onType: (v: LineTypeFilter) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(ops.length > 0 || directOnly || type !== 'all');
  const active = ops.length + (directOnly ? 1 : 0) + (type !== 'all' ? 1 : 0);
  return (
    <div className="border-t border-slate-100 pt-1 dark:border-slate-800" data-testid="advanced">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="advanced-toggle"
        className="flex min-h-10 w-full items-center gap-2 rounded-lg px-1 text-sm font-medium text-sky-700 dark:text-sky-300"
      >
        <Icon name="chevronDown" className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2.25} />
        {t('advancedSearch')}
        {active > 0 && <span className="rounded-full bg-sky-600 px-1.5 text-xs text-white">{active}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-1 pb-1 pt-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('connectionType')}</p>
          <div data-testid="type-filter">
            <TypeFilter value={type} onChange={onType} urbanLabel={t('typeUrbanCity')} className="max-w-full" />
          </div>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('operatorsLabel')}</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('operatorsLabel')}>
            {OPERATORS.map((o) => {
              const on = ops.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={on}
                  data-testid={`op-${o.id}`}
                  onClick={() => onOps(on ? ops.filter((x) => x !== o.id) : [...ops, o.id])}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors ${on ? 'border-sky-600 bg-sky-50 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}
                >
                  <span className="size-2.5 rounded-full" style={{ background: o.color }} />
                  {o.name}
                </button>
              );
            })}
          </div>
          <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm font-medium">
            <input type="checkbox" className="peer sr-only" checked={directOnly} onChange={(e) => onDirect(e.target.checked)} />
            <span className="relative h-6 w-11 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-sky-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500 dark:bg-slate-600" />
            {t('directOnlyShort')}
          </label>
        </div>
      )}
    </div>
  );
}

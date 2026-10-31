import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { OPERATORS, operatorOf, type Operator, type OperatorId } from '../lib/operators';
import type { Line } from '../types';
import { Icon } from './Icons';
import { matchesType, type LineTypeFilter, type Shared } from './common';

const byNumber = (a: Line, b: Line) => a.number.localeCompare(b.number, undefined, { numeric: true });
const initials: Record<OperatorId, string> = { hf: 'HF', rodoeste: 'RO', sam: 'SAM', cam: 'CAM' };

/** The two ends of a line as printed on its timetable. */
function ends(line: Line): string {
  const d = line.directions[0];
  if (!d) return line.route;
  const a = d.from ?? d.stops[0]?.name;
  return a && d.to ? `${a} ⇄ ${d.to}` : line.route;
}

function OperatorBadge({ op, line }: { op: Operator; line: Line }) {
  return <span className={`inline-flex h-7 min-w-11 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-bold tabular-nums tracking-tight text-white ${op.cls.badge}`}>{line.number}</span>;
}

/** All lines in sections by operator, each with its colour, label and the termini of every line. */
export function LineCatalog({ shared, type = 'all' }: { shared: Shared; type?: LineTypeFilter }) {
  const { t } = useT();
  const [open, setOpen] = useState<OperatorId | null>(null);
  const groups = useMemo(() => {
    const m = new Map<OperatorId, Line[]>(OPERATORS.map((o) => [o.id, []]));
    for (const l of shared.lines) if (matchesType(l, type)) m.get(operatorOf(l))!.push(l);
    for (const list of m.values()) list.sort(byNumber);
    return m;
  }, [shared.lines, type]);
  return (
    <section className="flex flex-col gap-3" data-testid="line-catalog">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('catalogTitle')}</h2>
      {OPERATORS.map((op) => {
        const list = groups.get(op.id)!;
        if (!list.length) return null;
        const isOpen = open === op.id;
        return (
          <div key={op.id} className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white dark:border-slate-700/70 dark:bg-slate-900" data-testid={`operator-${op.id}`}>
            <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : op.id)} className="flex w-full items-center gap-3 px-3 py-3 text-left">
              <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold tracking-wide text-white ${op.cls.bar}`} aria-hidden="true">
                {initials[op.id]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold leading-5">{op.name}</span>
                <span className="block truncate text-sm text-slate-500 dark:text-slate-400">{t(`op_${op.id}` as 'op_hf')}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${op.cls.soft}`}>{t(list.length === 1 ? 'linesCountOne' : 'linesCountMany', { n: list.length })}</span>
              <Icon name="chevron" className={`size-4 shrink-0 text-slate-300 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            </button>
            {isOpen && (
              <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                {list.map((l) => (
                  <button key={l.id} type="button" onClick={() => shared.openLine(l.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800/60 dark:active:bg-slate-800">
                    <OperatorBadge op={op} line={l} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{l.name}</span>
                      <span className="block truncate text-sm text-slate-500 dark:text-slate-400">{ends(l)}</span>
                    </span>
                    {!l.hasParsedSchedule && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">PDF</span>}
                    <Icon name="chevron" className="size-4 shrink-0 text-slate-300" />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

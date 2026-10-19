import { useMemo, useState } from 'react';
import { useDebounced } from '../lib/hooks';
import { useT } from '../i18n';
import { board } from '../lib/departures';
import { norm } from '../lib/search';
import { Card, dirLabel, EmptyState, LineBadge, matchesType, SearchInput, SectionTitle, Times, TypeFilter, type LineTypeFilter, type Shared } from './common';

export function DeparturesTab({ shared }: { shared: Shared }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [type, setType] = useState<LineTypeFilter>('all');
  const { ctx, lines } = shared;

  const rows = useMemo(() => {
    const tokens = norm(dq).split(' ').filter(Boolean);
    return board(lines, ctx, (line, dir) => {
      if (!matchesType(line, type)) return false;
      if (!tokens.length) return true;
      const hay = norm(`${line.number} ${line.oldNumber} ${line.name} ${dir.from ?? ''} ${dir.to} ${line.municipality ?? ''}`);
      return tokens.every((x) => hay.includes(x));
    });
    // `ctx` changes every minute, which refreshes the countdowns
  }, [lines, ctx, dq, type]);
  const unparsed = lines.filter((l) => !l.hasParsedSchedule).length;

  return (
    <div className="flex flex-col gap-4">
      <SearchInput value={q} onChange={setQ} placeholder={t('departuresFilter')} />
      <TypeFilter value={type} onChange={setType} className="self-start" />
      <section>
        <SectionTitle>{t('nextDepartures')}</SectionTitle>
        {!rows.length && <EmptyState icon="frown" title={t('noResultsTitle')} body={t('noResultsBody')} />}
        <div className="flex flex-col gap-2">
          {rows.slice(0, 80).map((r) => (
            <button key={`${r.line.id}-${r.dirIndex}`} onClick={() => shared.openLine(r.line.id, r.dirIndex)} className="rounded-2xl text-left transition-transform active:scale-[0.99]">
              <Card className="flex items-start gap-3 p-3.5! transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <LineBadge line={r.line} />
                <span className="min-w-0 flex-1">
                  <span className="mb-1 block truncate text-sm text-slate-500 dark:text-slate-400">{dirLabel(r.dir, r.line.name)}</span>
                  <Times list={r.next} t={t} />
                </span>
              </Card>
            </button>
          ))}
        </div>
      </section>
      {unparsed > 0 && <p className="px-1 text-xs text-slate-500">{t('noParsedLines', { n: unparsed })}</p>}
    </div>
  );
}

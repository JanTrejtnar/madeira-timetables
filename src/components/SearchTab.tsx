import { useMemo, useState } from 'react';
import { useDebounced } from '../lib/hooks';
import { useT } from '../i18n';
import { searchLines, searchStops, type Index } from '../lib/search';
import { Card, EmptyState, LineBadge, matchesType, SearchInput, SectionTitle, SkeletonCards, TypeFilter, type LineTypeFilter, type Shared } from './common';
import { Icon } from './Icons';

export function SearchTab({ shared, index }: { shared: Shared; index: Index }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [type, setType] = useState<LineTypeFilter>('all');
  const lines = useMemo(() => searchLines(index, dq).filter((l) => matchesType(l, type)), [index, dq, type]);
  const stops = useMemo(
    () =>
      searchStops(index, dq)
        .map((s) => ({ ...s, lines: s.lines.filter((l) => matchesType(l, type)) }))
        .filter((s) => s.lines.length),
    [index, dq, type],
  );
  const pending = q.trim() !== dq.trim();

  return (
    <div className="flex flex-col gap-4">
      <SearchInput value={q} onChange={setQ} placeholder={t('searchPlaceholder')} autoFocus />
      <TypeFilter value={type} onChange={setType} className="self-start" />

      {!q.trim() && <EmptyState icon="search" title={t('searchEmptyTitle')} body={t('searchHint')} />}
      {pending && q.trim() && <SkeletonCards n={3} />}
      {!pending && dq.trim() && !lines.length && !stops.length && <EmptyState icon="frown" title={t('noResultsTitle')} body={t('noResultsBody')} />}

      {!pending && stops.length > 0 && (
        <section>
          <SectionTitle>{t('stops')}</SectionTitle>
          <div className="flex flex-col gap-2">
            {stops.map((s) => (
              <Card key={s.key} className="p-3.5!">
                <div className="flex items-center gap-2 font-medium">
                  <Icon name="pin" className="size-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">{s.name}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {s.lines.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => shared.openLine(l.id)}
                      aria-label={`${l.number} ${l.name}`}
                      className="rounded-lg transition-opacity hover:opacity-80 active:opacity-70"
                    >
                      <LineBadge line={l} />
                    </button>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {!pending && lines.length > 0 && (
        <section>
          <SectionTitle aside={<span className="text-xs text-slate-400">{lines.length}</span>}>{t('lines')}</SectionTitle>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/70 bg-white dark:divide-slate-800 dark:border-slate-700/70 dark:bg-slate-900">
            {lines.slice(0, 60).map((l) => (
              <button
                key={l.id}
                onClick={() => shared.openLine(l.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800/60 dark:active:bg-slate-800"
              >
                <LineBadge line={l} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{l.name}</span>
                  <span className="block truncate text-sm text-slate-500 dark:text-slate-400">
                    {l.route}
                    {l.municipality ? ` · ${l.municipality}` : ''}
                  </span>
                </span>
                {!l.hasParsedSchedule && (
                  <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">PDF</span>
                )}
                <Icon name="chevron" className="size-4 shrink-0 text-slate-300" />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useT, type Key } from '../../i18n';
import { localStopName } from '../../lib/text';
import { CITY_PREFIX, PARISH_PREFIX, type Suggestion } from '../../lib/network';
import { KIND_META, poiKey } from '../../lib/places';
import type { Picked } from '../../lib/plannerForm';
import { useDebounced } from '../../lib/hooks';
import type { Shared } from '../common';
import { Icon } from '../Icons';
import { useSuggestions, type Item } from './useSuggestions';

/** A text field with the suggestion list (stops, areas, places), a clear button, "my location" and "pick on map". */
export function Combobox({ label, placeholder, value, onChange, onCommit, shared, onPickMap, onLocate, locating }: { label: string; placeholder: string; value: Picked; onChange: (v: Picked) => void; onCommit: () => void; shared: Shared; onPickMap: () => void; onLocate?: () => void; locating?: boolean }) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(value.text, 120);
  const items = useSuggestions(debounced, open, shared);
  const box = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  useEffect(() => {
    const close = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  // a new list starts without a highlighted item; the highlighted one is kept in view when scrolling with the arrows
  useEffect(() => setActive(-1), [items]);
  useEffect(() => {
    if (active >= 0) box.current?.querySelector(`[id="${listId}-${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  // "(all stops)" is a qualifier, not part of the name: the field shows just "Funchal", the list keeps the qualifier in a lighter tone
  const suffix = t('allStopsOf', { name: '' }).trim();
  const isGroupValue = !!value.key && (value.key.startsWith(PARISH_PREFIX) || value.key.startsWith(CITY_PREFIX)) && value.text.endsWith(suffix);
  const shownText = isGroupValue ? value.text.slice(0, -suffix.length).trimEnd() : value.text;
  const labelOf = (s: Suggestion) => (s.group ? t('allStopsOf', { name: s.name }) : localStopName(s.name, lang));
  const pick = (it: Item) => {
    if (it.kind === 'stop') onChange({ text: labelOf(it.s), key: it.s.key });
    else onChange({ text: it.place.name, key: poiKey(it.place), pt: { lat: +it.place.lat.toFixed(5), lon: +it.place.lon.toFixed(5) } });
    setOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (!items.length) return;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1));
    } else if (e.key === 'Enter' && open && items.length) {
      // the highlighted item, else the first suggestion (a municipality group when a town is typed)
      e.preventDefault();
      pick(items[active >= 0 ? active : 0]);
    } else if (e.key === 'Enter') {
      // typed text without a suggestion to take: search for it as it stands
      e.preventDefault();
      onCommit();
      setOpen(false);
    }
  };

  return (
    <div ref={box} className="relative flex items-center">
      <input
        ref={inputRef}
        value={shownText}
        onChange={(e) => {
          onChange({ text: e.target.value, key: null });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="h-11 min-w-[4.5rem] flex-1 rounded-lg bg-transparent px-2 text-base font-medium outline-none placeholder:font-normal placeholder:text-slate-400 focus:bg-slate-50 dark:focus:bg-slate-800/60"
      />
      {value.text && (
        <button
          type="button"
          onClick={() => {
            onChange({ text: '', key: null });
            inputRef.current?.focus();
            setOpen(true);
          }}
          aria-label={`${t('clearText')}: ${label}`}
          title={t('clearText')}
          data-testid="clear-input"
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-slate-500 before:absolute before:-inset-1.5 before:content-[''] transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        >
          <Icon name="close" className="size-4" strokeWidth={2.25} />
        </button>
      )}
      {onLocate && (
        <button
          type="button"
          onClick={onLocate}
          disabled={locating}
          aria-label={t('useMyLocation')}
          title={t('useMyLocation')}
          data-testid="use-my-location"
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-slate-500 before:absolute before:-inset-1.5 before:content-[''] transition-colors hover:bg-slate-100 hover:text-sky-600 dark:hover:bg-slate-800"
        >
          <Icon name="navigation" className={`size-5 ${locating ? 'animate-pulse' : ''}`} />
        </button>
      )}
      <button
        type="button"
        onClick={onPickMap}
        aria-label={`${t('pickOnMap')}: ${label}`}
        title={t('pickOnMap')}
        className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-slate-500 before:absolute before:-inset-1.5 before:content-[''] transition-colors hover:bg-slate-100 hover:text-sky-600 dark:hover:bg-slate-800"
      >
        <Icon name="map" className="size-5" />
      </button>
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute -left-9 -right-12 top-full z-30 mt-2 max-h-80 overflow-auto rounded-2xl border border-slate-200/70 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {items.map((it, i) => {
            const group = it.kind === 'stop' && it.s.group;
            const meta = it.kind === 'place' ? KIND_META[it.place.kind] : group ? KIND_META.town : KIND_META.stop;
            const category = it.kind === 'place' ? t(`kind_${it.place.kind}` as Key) : group ? t('kind_group') : t('kind_stop');
            const name = it.kind === 'place' ? it.place.name : group ? it.s.name : localStopName(it.s.name, lang);
            return (
              <li key={it.kind === 'place' ? `p:${poiKey(it.place)}:${it.place.lat}` : it.s.key} id={`${listId}-${i}`} role="option" aria-selected={i === active} data-kind={it.kind === 'place' ? it.place.kind : group ? 'group' : 'stop'}>
                <button
                  tabIndex={-1}
                  className={`flex min-h-11 w-full items-center gap-3 px-4 text-left hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800 ${group ? 'font-semibold' : ''} ${
                    i === active ? 'bg-sky-100 dark:bg-sky-400/20' : group ? 'bg-sky-50/70 dark:bg-sky-400/10' : ''
                  }`}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => pick(it)}
                >
                  <Icon name={meta.icon} className={`size-4 shrink-0 ${meta.tone}`} />
                  <span className="min-w-0 flex-1 truncate">
                    {name}
                    {group && <>{' '}<span className="text-xs font-normal text-slate-500">{suffix}</span></>}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {category}
                    {it.kind === 'stop' && !group ? ` · ${it.s.lines}×` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

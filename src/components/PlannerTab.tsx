import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useT, type Key } from '../i18n';
import { localStopName } from '../lib/text';
import { detoursFor } from '../lib/via';
import { addDays, serviceDay } from '../lib/holidays';
import { fmtMinutes } from '../lib/time';
import { plainPlace } from '../lib/text';
import { CITY_PREFIX, PARISH_PREFIX, FAR_PLACE_M, NEAR_PLACE_M, hubsNear, nearbyStopNodes, nearestNode, nodeIdsOfKeys, nodesNearPoint, resolveNodes, servicesFor, suggest, tripStops, type Suggestion } from '../lib/network';
import { norm } from '../lib/search';
import { KIND_META, isPoiKey, loadPlaces, poiKey, searchPlaces, type Place, type PlaceIndex } from '../lib/places';
import { useFootRoutes, type FootPair } from '../lib/foot';
import { sameTrip } from '../lib/trips-store';
import { isoToYmd, ymdToIso, type Picked, type PlannerForm } from '../lib/plannerForm';
import { plan, type Itinerary } from '../lib/router';
import { useDebounced } from '../lib/hooks';
import { DepartPicker } from './Pickers';
import { ConnectionCard, ConnectionDetail, endWalks, shortDate } from './Connection';
import { walkTo } from '../lib/walk';
import type { MapLayer, MapPin as PickedPin } from '../types';
import { OPERATORS, operatorOf, type OperatorId } from '../lib/operators';
import { badgeText, Card, Chip, EmptyState, EstTag, LEG_COLORS, lineColor, TypeFilter, matchesType, type Shared } from './common';
import { Icon } from './Icons';
import type { LineTypeFilter } from './common';
import { MapPicker, PICK_RADIUS_M } from './MapPicker';
import { RouteMap } from './RouteMap';
import { TripShortcuts } from './TripShortcuts';

/** A row of the suggestion list: a stop (or an "all stops of" area) or a place of interest. */
type Item = { kind: 'stop'; s: Suggestion } | { kind: 'place'; place: Place };

/** Stops, areas and places for what was typed: areas first, then stops and places by how well they match, important kinds first. */
function useSuggestions(query: string, open: boolean, shared: Shared): Item[] {
  const [ix, setIx] = useState<PlaceIndex | null>(null);
  useEffect(() => {
    let alive = true;
    loadPlaces().then((i) => alive && setIx(i), () => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return useMemo(() => {
    if (!open) return [];
    const q = norm(query);
    const found = suggest(shared.net, shared.lines, query);
    const groups = found.filter((s) => s.group);
    const stops = found.filter((s) => !s.group);
    // a town or village that is also a stop or an area of the same name is offered once, as the stop (its lines are known)
    const names = new Set(found.map((s) => norm(s.name.split(',')[0])));
    const places = (ix ? searchPlaces(ix, query, 10) : []).filter((h) => !((h.place.kind === 'town' || h.place.kind === 'village') && names.has(norm(h.place.name))));
    const rows: { item: Item; score: number; rank: number }[] = [
      ...stops.map((s) => ({ item: { kind: 'stop', s } as Item, score: norm(s.name) === q ? 0 : norm(s.name).startsWith(q) ? 1 : 2, rank: KIND_META.stop.rank })),
      ...places.map((h) => ({ item: { kind: 'place', place: h.place } as Item, score: h.score, rank: KIND_META[h.place.kind].rank })),
    ];
    rows.sort((a, b) => a.score - b.score || a.rank - b.rank);
    return [...groups.map((s) => ({ kind: 'stop', s }) as Item), ...rows.slice(0, Math.max(5, 10 - groups.length)).map((r) => r.item)];
  }, [open, query, ix, shared.net, shared.lines]);
}

function Combobox({ label, placeholder, value, onChange, onCommit, shared, onPickMap, onLocate, locating }: { label: string; placeholder: string; value: Picked; onChange: (v: Picked) => void; onCommit: () => void; shared: Shared; onPickMap: () => void; onLocate?: () => void; locating?: boolean }) {
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
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
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
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-sky-600 dark:hover:bg-slate-800"
        >
          <Icon name="navigation" className={`size-5 ${locating ? 'animate-pulse' : ''}`} />
        </button>
      )}
      <button
        type="button"
        onClick={onPickMap}
        aria-label={`${t('pickOnMap')}: ${label}`}
        title={t('pickOnMap')}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-sky-600 dark:hover:bg-slate-800"
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
                    {group && <>{' '}<span className="text-xs font-normal text-slate-400">{suffix}</span></>}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
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

/** "Advanced search": collapsed by default; the operators to travel with (none ticked = all) and direct connections only. */
function AdvancedSearch({ ops, directOnly, type, onOps, onDirect, onType }: { ops: OperatorId[]; directOnly: boolean; type: LineTypeFilter; onOps: (v: OperatorId[]) => void; onDirect: (v: boolean) => void; onType: (v: LineTypeFilter) => void }) {
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

/** a picked stop also stands for the stops this many minutes away on foot */
const NEAR_STOP_MIN = 3;

/** straight-line reach (about 12 minutes on foot over winding roads) within which a transfer hub counts as a start of the journey */
const HUB_WALK_M = 650;

/** "← Earlier connections" / "Later connections →" above and below the list; greyed out with a note once nothing more was found. */
function StepButton({ onClick, spent, label, spentLabel, testid }: { onClick: () => void; spent: boolean; label: string; spentLabel: string; testid: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={spent}
      data-testid={testid}
      className="h-11 w-full rounded-xl border border-slate-200 bg-white text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 disabled:text-slate-400 disabled:hover:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-slate-800 dark:disabled:text-slate-500"
    >
      {spent ? spentLabel : label}
    </button>
  );
}

export function PlannerTab({ shared }: { shared: Shared }) {
  const { t, lang } = useT();
  const { planner, setPlanner, applied, commit } = shared;
  const { from, to, time, ops, directOnly, type } = planner;
  const patch = (p: Partial<PlannerForm>) => setPlanner((f) => ({ ...f, ...p }));
  const setFrom = (v: Picked) => {
    setLocNote(null);
    patch({ from: v });
  };
  const setTo = (v: Picked) => patch({ to: v });
  // the connection opened in the detail page (null = the list of results)
  // a stored connection belongs to the search it was opened for: another search (or day, time, filter) starts at the list again
  const searchSig = JSON.stringify([applied.from, applied.to, planner.date, planner.time, planner.ops, planner.directOnly, planner.type, shared.ctx.school]);
  const { openConn, setOpenConn } = shared;
  const openKey = openConn?.startsWith(`${searchSig}`) ? openConn.slice(searchSig.length + 1) : null;
  const setOpenKey = (k: string | null) => setOpenConn(k === null ? null : `${searchSig}${k}`);
  const [pickFor, setPickFor] = useState<'from' | 'to' | null>(null);
  // "My location": the position is asked for, then the nearest stop (within 1 km) becomes the start and the walk to it is shown under the field
  const { userPos, geo, locate } = shared;
  const [wantsLocation, setWantsLocation] = useState(false);
  const [locNote, setLocNote] = useState<string | null>(null);
  const seenFix = useRef(userPos?.seq);
  const locateMe = () => {
    setWantsLocation(true);
    setLocNote(null);
    locate();
  };
  useEffect(() => {
    if (!wantsLocation) return;
    if (geo === 'denied' || geo === 'error' || geo === 'unsupported') {
      setWantsLocation(false);
      setLocNote(t(geo === 'denied' ? 'geoDenied' : geo === 'error' ? 'geoError' : 'geoUnsupported'));
      return;
    }
    if (!userPos || userPos.seq === seenFix.current) return;
    seenFix.current = userPos.seq;
    setWantsLocation(false);
    const hit = nearestNode(shared.net, userPos.lat, userPos.lon, PICK_RADIUS_M);
    if (!hit) return setLocNote(t('pickNone', { m: PICK_RADIUS_M }));
    const name = localStopName(hit.node.name, lang);
    const w = walkTo(userPos, hit.node);
    setPlanner((f) => ({ ...f, from: { text: t('myLocationText', { name }), key: hit.node.key, pt: { lat: +userPos.lat.toFixed(5), lon: +userPos.lon.toFixed(5) } } }));
    setLocNote(w ? t('nearestStopWalk', { name, m: w.m, n: w.min }) : null);
  }, [wantsLocation, geo, userPos, shared.net, t, lang, setPlanner]);

  const { y: ny, m: nm, d: nd } = shared.ctx.now;
  const today = useMemo(() => ({ y: ny, m: nm, d: nd }), [ny, nm, nd]);
  const todayIso = ymdToIso(today);
  // the chosen day (any date); null = today
  const date = useMemo(() => isoToYmd(planner.date) ?? today, [planner.date, today]);
  const dateIso = ymdToIso(date);
  const dayInfo = useMemo(() => serviceDay(date, shared.ctx.municipalities), [date, shared.ctx.municipalities]);
  // all trips of the day; rebuilt only when the date or the school switch changes
  const trips = useMemo(() => servicesFor(shared.net, shared.lines, date, shared.ctx.school, shared.ctx.municipalities), [shared.net, shared.lines, date, shared.ctx.school, shared.ctx.municipalities]);

  // results and map follow the applied values: a picked suggestion / map point or Enter, never the keystrokes
  const dFrom = applied.from;
  const dTo = applied.to;
  const searched = shared.plannerView === 'results';
  // "leave now": the clock is read while the form is open and frozen once the results are shown, so the list does not shift under the reader
  const [frozenNow, setFrozenNow] = useState(shared.ctx.now.minutes);
  useEffect(() => {
    if (!searched) setFrozenNow(shared.ctx.now.minutes);
  }, [searched, shared.ctx.now.minutes]);
  const [h, m] = (time ?? '').split(':').map(Number);
  const departAt = time === null ? frozenNow : (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);

  // the search for a departure time (minutes from midnight of the chosen day, may pass 24:00): the results, and the "earlier / later" probes
  const run = useCallback((at: number) => {
    if (!searched) return null;
    // a picked place (beach, hotel, viewpoint ...) stands for the stops within walking distance of it; a stop or area for its own nodes
    const nodesOf = (p: Picked) => {
      if (isPoiKey(p.key) && p.pt) {
        const r = nodesNearPoint(shared.net, p.pt.lat, p.pt.lon);
        return { ids: nodeIdsOfKeys(shared.net, r.nodes.map((x) => x.node.key)), widened: r.widened, place: true, base: undefined, extra: undefined, at: undefined };
      }
      const ids = resolveNodes(shared.net, p.text, p.key);
      // a picked stop: the stops a few minutes' walk away count too (the other side of the road is often named differently and has the
      // buses of the other direction); `base` = the picked stop itself, `extra` = those stops with the minutes to walk to them
      const base = new Set(ids);
      const extra = new Map<number, number>();
      const isStop = !!p.key && !p.pt && !p.key.startsWith(PARISH_PREFIX) && !p.key.startsWith(CITY_PREFIX) && !isPoiKey(p.key);
      const at = isStop ? [...base].map((id) => shared.net.nodes[id]).find((n) => n.lat !== undefined && n.lon !== undefined) : undefined;
      if (at) {
        for (const [id, min] of nearbyStopNodes(shared.net, base, NEAR_STOP_MIN)) extra.set(id, min);
        for (const id of extra.keys()) ids.add(id);
      }
      return { ids, widened: false, place: false, base, extra, at: at ? { lat: at.lat as number, lon: at.lon as number } : undefined };
    };
    const na = nodesOf(dFrom);
    const nb = nodesOf(dTo);
    const A = na.ids;
    const B = nb.ids;
    if (!dFrom.text.trim() || !dTo.text.trim()) return null;
    const only = trips.filter((tr) => matchesType(tr.line, type) && (!ops.length || ops.includes(operatorOf(tr.line))));
    // walking from a picked start point: a bus counts only when it leaves after departAt + the walk to its stop
    let walkIn: Map<number, number> | undefined;
    if (na.extra?.size) walkIn = new Map(na.extra);
    if (dFrom.pt) {
      // a terminal within walking reach is a boarding point too: leaving from there beats a one-stop city hop to it
      for (const hub of hubsNear(shared.net, dFrom.pt.lat, dFrom.pt.lon, HUB_WALK_M)) A.add(hub.id);
      walkIn = new Map();
      for (const id of A) {
        const w = walkTo(dFrom.pt, shared.net.nodes[id]);
        if (w) walkIn.set(id, w.min);
      }
    }
    // walking to a picked destination point: the stop where one arrives first counts, bus arrival + walk
    let walkOut: Map<number, number> | undefined;
    if (nb.extra?.size) walkOut = new Map(nb.extra);
    if (dTo.pt) {
      walkOut = new Map();
      for (const id of B) {
        const w = walkTo(dTo.pt, shared.net.nodes[id]);
        if (w) walkOut.set(id, w.min);
      }
    }
    let found = plan(shared.net, only, A, B, at, walkIn, walkOut);
    // "Funchal" as a whole town: leave from its terminals (Rodoeste, SAM, CAM, the cable car ...); a wayside stop is offered only when nothing leaves from a terminal
    if (!dFrom.pt && dFrom.key?.startsWith(CITY_PREFIX)) {
      // a terminal: marked as one, a transfer hub, or the stop where a line starts (the Areeiro bus leaves from its own stop at the cable car)
      const starts = new Set(only.map((tr) => tr.nodes[0]));
      const terminals = new Set([...A].filter((id) => shared.net.nodes[id].terminal || shared.net.nodes[id].transferHub || starts.has(id)));
      if (terminals.size && terminals.size < A.size) {
        const fromTerminals = plan(shared.net, only, terminals, B, at, walkIn, walkOut);
        if (fromTerminals.direct.length || fromTerminals.transfers.length) found = fromTerminals;
      }
    }
    // "Funchal" as a whole town: a connection that rides within the town to board the next bus at a stop of the town is just that bus
    // (offered as it is, from its own start); the traveller chose any stop of the town as the start
    if (!dFrom.pt && dFrom.key?.startsWith(CITY_PREFIX)) {
      found = { ...found, transfers: found.transfers.filter((it) => !A.has(it.legs[1].trip.nodes[it.legs[1].fromPos])) };
    }
    const missing = na.place && A.size === 0 ? dFrom.text : nb.place && B.size === 0 ? dTo.text : null;
    const far = na.widened ? dFrom.text : nb.widened ? dTo.text : null;
    return { A: A.size, B: B.size, missing, far, ext: { from: na.at && na.base ? { pt: na.at, base: na.base } : undefined, to: nb.at && nb.base ? { pt: nb.at, base: nb.base } : undefined }, plan: directOnly ? { ...found, transfers: [] } : found };
  }, [shared.net, trips, dFrom, dTo, ops, directOnly, type, searched]);
  const result = useMemo(() => run(departAt), [run, departAt]);

  // the point to walk from / to for a connection: a picked place or map point, or the picked stop when the bus boards / alights at another stop near it
  const fromPtOf = (it?: Itinerary) => dFrom.pt ?? (it && result?.ext.from && !result.ext.from.base.has(it.legs[0].trip.nodes[it.legs[0].fromPos]) ? result.ext.from.pt : undefined);
  const toPtOf = (it?: Itinerary) => {
    const last = it?.legs[it.legs.length - 1];
    return dTo.pt ?? (last && result?.ext.to && !result.ext.to.base.has(last.trip.nodes[last.toPos]) ? result.ext.to.pt : undefined);
  };
  const empty = result && !result.plan.direct.length && !result.plan.transfers.length;
  const all = useMemo(
    () =>
      result
        ? [...result.plan.direct.map((it, i) => ({ key: `d${i}`, it })), ...result.plan.transfers.map((it, i) => ({ key: `t${i}`, it }))].sort((a, b) => a.it.depart - b.it.depart || a.it.finish - b.it.finish)
        : [],
    [result],
  );
  const anyEstimated = all.some(({ it }) => it.legs.some((l) => l.departEstimated || l.arriveEstimated));
  const selected = all.find((x) => x.key === openKey) ?? all[0];
  const opened = openKey !== null && selected?.key === openKey ? selected : null;
  // the "(all stops)" qualifier is noise in a one-line summary
  const plain = (text: string) => plainPlace(text, t('allStopsOf', { name: '' }).trim(), lang);
  const startSearch = () => {
    commit({ from, to });
    shared.setPlannerView('results');
    window.scrollTo(0, 0);
    scroller()?.scrollTo(0, 0);
  };
  const listScroll = useRef(0);
  const scroller = () => document.getElementById('scroller');

  // "earlier / later connections": the departure time of the search moves to just before the first / after the last connection shown;
  // it goes into the URL (time, and date when it passes midnight), so a reload or a shared link keeps the window
  const [spentAt, setSpentAt] = useState<{ sig: string; early?: true; late?: true }>({ sig: '' });
  const spent = spentAt.sig === searchSig ? spentAt : { sig: searchSig };
  const leadWalk = (it: Itinerary) => endWalks(it, fromPtOf(it), undefined).walkIn?.min ?? 0;
  const moveTo = (abs: number) => {
    const iso = ymdToIso(addDays(date, Math.floor(abs / 1440)));
    patch({ time: fmtMinutes(abs), date: iso === todayIso ? null : iso });
    window.scrollTo(0, 0);
    scroller()?.scrollTo(0, 0);
  };
  const later = () => {
    const it = all[all.length - 1]?.it;
    if (!it) return;
    const at = Math.max(0, it.depart + 1 - leadWalk(it));
    const r = run(at);
    if (r && [...r.plan.direct, ...r.plan.transfers].some((x) => x.depart > it.depart)) moveTo(at);
    else setSpentAt({ ...spent, sig: searchSig, late: true });
  };
  const earlier = () => {
    const it = all[0]?.it;
    if (!it) return;
    // widen the look-back until something earlier turns up
    for (const back of [90, 240, 720, 1440]) {
      const at = Math.max(0, it.depart - leadWalk(it) - back);
      const r = run(at);
      if (r && [...r.plan.direct, ...r.plan.transfers].some((x) => x.depart < it.depart)) return moveTo(at);
      if (at === 0) break;
    }
    setSpentAt({ ...spent, sig: searchSig, early: true });
  };
  // a shared link names a connection (`?c=line.departure`): open its detail once the results are in
  const { pendingConn, clearPendingConn } = shared;
  useEffect(() => {
    if (!pendingConn || !searched) return;
    const hit = all.find(({ it }) => it.legs[0].trip.line.id === pendingConn.lineId && fmtMinutes(it.legs[0].depart) === pendingConn.dep);
    if (hit) setOpenKey(hit.key);
    clearPendingConn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingConn, searched, all]);
  const openConnection = (k: string) => {
    listScroll.current = Math.max(window.scrollY, scroller()?.scrollTop ?? 0);
    setOpenKey(k);
    window.scrollTo(0, 0);
    scroller()?.scrollTo(0, 0);
  };
  const closeConnection = () => {
    setOpenKey(null);
    requestAnimationFrame(() => {
      window.scrollTo(0, listScroll.current);
      scroller()?.scrollTo(0, listScroll.current);
    });
  };

  // walking along the streets for the selected itinerary: from the picked point to the first stop, from the last stop to the picked point, between the platforms of a transfer
  const footPairs: FootPair[] = (() => {
    if (!selected) return [];
    const legs = selected.it.legs;
    const ll = (s: { lat?: number; lon?: number }) => (s.lat !== undefined && s.lon !== undefined ? { lat: s.lat, lon: s.lon } : null);
    const first = ll(tripStops(legs[0].trip)[legs[0].fromPos]);
    const lastLeg = legs[legs.length - 1];
    const lastStop = ll(tripStops(lastLeg.trip)[lastLeg.toPos]);
    const sFrom = fromPtOf(selected.it);
    const sTo = toPtOf(selected.it);
    const pairs: FootPair[] = [sFrom && first ? [sFrom, first] : null, sTo && lastStop ? [lastStop, sTo] : null];
    legs.slice(0, -1).forEach((l, i) => {
      const a = ll(tripStops(l.trip)[l.toPos]);
      const b = ll(tripStops(legs[i + 1].trip)[legs[i + 1].fromPos]);
      pairs.push(a && b && Math.hypot((b.lat - a.lat) * 110540, (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180)) > 5 ? [a, b] : null);
    });
    return pairs;
  })();
  const foot = useFootRoutes(footPairs);
  const selFrom = fromPtOf(selected?.it);
  const selTo = toPtOf(selected?.it);
  const footSig = foot.map((r) => (r ? r.m : '-')).join(',');

  // the selected itinerary is drawn on the map (desktop side map, small map on the phone when a point was picked)
  const rawLayers = useMemo<MapLayer[] | null>(() => {
    if (!selected) return null;
    const legs = selected.it.legs;
    // A / B always mark the start and the destination: the picked point, else the boarding / alighting stop itself (no walk to draw then)
    const pinFor = (kind: PickedPin['kind'], pt: Picked['pt'], stop: { lat?: number; lon?: number; name: string }, path?: [number, number][]): PickedPin | null => {
      const at = pt ?? (stop.lat !== undefined && stop.lon !== undefined ? { lat: stop.lat, lon: stop.lon } : null);
      if (!at) return null;
      return { kind, label: t(kind === 'from' ? 'mapStart' : 'mapEnd'), lat: at.lat, lon: at.lon, stop: stop.lat !== undefined && stop.lon !== undefined ? { lat: stop.lat, lon: stop.lon, name: stop.name } : undefined, ...(pt && path ? { path } : {}) };
    };
    const first = tripStops(legs[0].trip)[legs[0].fromPos];
    const lastLeg = legs[legs.length - 1];
    const pins = [pinFor('from', selFrom, first, foot[0]?.pts), pinFor('to', selTo, tripStops(lastLeg.trip)[lastLeg.toPos], foot[1]?.pts)].filter((p): p is PickedPin => p !== null);
    // every change of bus: the alighting stop, and the walk to the platform of the next bus when that is another stop
    const transfers = legs.slice(0, -1).flatMap((l, i) => {
      const a = tripStops(l.trip)[l.toPos];
      const b = tripStops(legs[i + 1].trip)[legs[i + 1].fromPos];
      if (a.lat === undefined || a.lon === undefined) return [];
      const at: [number, number] = [a.lat, a.lon];
      const apart = b.lat !== undefined && b.lon !== undefined && Math.hypot((b.lat - a.lat) * 110540, (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180)) > 5;
      return [{ name: a.name, at, ...(apart ? { to: [b.lat, b.lon] as [number, number] } : {}), ...(apart && foot[2 + i] ? { path: foot[2 + i]!.pts } : {}) }];
    });
    return legs.map((l, i) => ({
      shapeId: l.trip.dir.shapeId,
      // a dash in the timetable (no time) = the trip does not call there: not drawn
      stops: tripStops(l.trip).slice(l.fromPos, l.toPos + 1).filter((_, k) => l.trip.times[l.fromPos + k] !== null),
      // with a transfer every bus gets its own colour and a place in the legend
      color: legs.length > 1 ? LEG_COLORS[i % LEG_COLORS.length] : lineColor(l.trip.line),
      ...(legs.length > 1 ? { legend: { badge: badgeText(l.trip.line), text: `${localStopName(tripStops(l.trip)[l.fromPos].name, lang)} → ${localStopName(tripStops(l.trip)[l.toPos].name, lang)}` } } : {}),
      detours: detoursFor(l.trip.line, l.trip.dirIndex, l.trip.notes),
      trip: { stops: tripStops(l.trip).flatMap((s, k) => (s.lat !== undefined && s.lon !== undefined ? [{ at: [s.lat, s.lon] as [number, number], calls: l.trip.times[k] !== null }] : [])) },
      ride: { stops: tripStops(l.trip).map((s) => (s.lat !== undefined && s.lon !== undefined ? ([s.lat, s.lon] as [number, number]) : null)), from: l.fromPos, to: l.toPos },
      ...(i === 0 && pins.length ? { pins } : {}),
      ...(i === 0 && transfers.length ? { transfers } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selFrom, selTo, footSig, t, lang]);
  const layers = rawLayers;
  const { desktop, setMap } = shared;
  useEffect(() => {
    if (!desktop) return;
    setMap(layers);
    return () => setMap(null);
  }, [desktop, setMap, layers]);

  // a search that found stops at both ends goes to the recent trips (after a moment, so a passing pick is not stored)
  const { rememberTrip } = shared;
  const searchable = !!result && result.A > 0 && result.B > 0;
  useEffect(() => {
    if (!searchable) return;
    const id = setTimeout(() => rememberTrip({ from: dFrom, to: dTo }), 1200);
    return () => clearTimeout(id);
  }, [searchable, dFrom, dTo, rememberTrip]);
  const starred = !!dFrom.text.trim() && !!dTo.text.trim() && shared.favorites.some((f) => sameTrip(f, { from: dFrom, to: dTo }));

  const estimatedNote = anyEstimated ? (
    <p className="flex items-start gap-2 px-1 text-xs text-slate-500">
      <EstTag>~</EstTag>
      <span>{t('estimatedLegend').replace(/^~ = /, '')}</span>
    </p>
  ) : null;

  if (opened) {
    return (
      <ConnectionDetail
        it={opened.it}
        shared={shared}
        base={date}
        onBack={closeConnection}
        fromPt={fromPtOf(opened.it)}
        toPt={toPtOf(opened.it)}
        map={!desktop && layers ? <div data-testid="planner-map"><RouteMap layers={layers} /></div> : null}
        estimatedNote={estimatedNote}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!searched && (
      <Card className="flex flex-col gap-3 p-3!">
        <div className="flex items-stretch gap-2">
          <div className="flex w-5 shrink-0 flex-col items-center pb-3.5 pt-4.25">
            <span className="size-2.5 rounded-full border-[2.5px] border-sky-600" />
            <span className="my-1 w-0 flex-1 border-l-2 border-dotted border-slate-300 dark:border-slate-600" />
            <Icon name="pin" className="size-4 text-sky-600" strokeWidth={2} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <Combobox label={t('from')} placeholder={t('fromPlaceholderPlace')} value={from} onChange={setFrom} onCommit={() => commit({ from })} shared={shared} onPickMap={() => setPickFor('from')} onLocate={locateMe} locating={shared.geo === 'busy'} />
            {locNote && (
              <p className="px-2 pb-1 text-xs text-slate-500 dark:text-slate-400" data-testid="location-note" aria-live="polite">
                {locNote}
              </p>
            )}
            <div className="mx-2 h-px bg-slate-100 dark:bg-slate-800" />
            <Combobox label={t('to')} placeholder={t('toPlaceholderPlace')} value={to} onChange={setTo} onCommit={() => commit({ to })} shared={shared} onPickMap={() => setPickFor('to')} />
          </div>
          <div className="flex shrink-0 flex-col items-center justify-center gap-1.5">
            <button
              onClick={() => {
                patch({ from: to, to: from });
                commit({ from: to, to: from });
              }}
              aria-label={t('swap')}
              title={t('swap')}
              className="size-10 shrink-0 rounded-full border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-sky-600 active:rotate-180 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <Icon name="swap" className="mx-auto size-5" />
            </button>
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
            today={today}
            nowMinutes={shared.ctx.now.minutes}
            note={`${dayInfo.type === null ? t('noService') : t(`day_${dayInfo.type}`)}${dayInfo.reason === 'holiday' ? ` · ${t('reason_holiday')}: ${dayInfo.holiday?.name}` : dayInfo.reason === 'saturday-rule' ? ` · ${dayInfo.special}` : dayInfo.holiday ? ` · ${dayInfo.holiday.name}` : ''}`}
            onChange={(v) => patch(v)}
          />
        </div>
        <AdvancedSearch ops={ops} directOnly={directOnly} type={type} onOps={(v) => patch({ ops: v })} onDirect={(v) => patch({ directOnly: v })} onType={(v) => patch({ type: v })} />
        <button
          type="button"
          onClick={startSearch}
          disabled={!from.text.trim() || !to.text.trim()}
          data-testid="search-button"
          className="h-12 w-full rounded-xl bg-sky-600 text-base font-semibold text-white transition-colors hover:bg-sky-700 active:bg-sky-800 disabled:opacity-40"
        >
          {t('searchButton')}
        </button>
      </Card>
      )}

      {!searched && <TripShortcuts shared={shared} />}

      {searched && (
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
      )}

      {searched && !result && <EmptyState icon="route" title={t('plannerEmptyTitle')} body={t('plannerHint')} />}
      {result && (result.A === 0 || result.B === 0) && <EmptyState icon="alert" tone="warn" title={t('noStopNodesTitle')} body={result.missing ? t('placeNoStop', { place: result.missing, m: FAR_PLACE_M }) : t('noStopNodes')} />}
      {result?.far && result.A > 0 && result.B > 0 && (
        <p className="px-1 text-sm text-amber-700 dark:text-amber-300" data-testid="place-far">
          {t('placeFar', { place: result.far, m: NEAR_PLACE_M })}
        </p>
      )}
      {empty && result.A > 0 && result.B > 0 && <EmptyState icon="frown" title={t('noConnectionTitle')} body={t('noConnectionBody')} />}
      {empty && result.A > 0 && result.B > 0 && (ops.length > 0 || directOnly || type !== 'all') && (
        <div className="flex justify-center">
          <Chip
            onClick={() => {
              patch({ ops: [], directOnly: false, type: 'all' });
            }}
          >
            {t('tryAllTypes')}
          </Chip>
        </div>
      )}

      {all.length > 0 && (
        <div className="flex flex-col gap-3">
          <StepButton onClick={earlier} spent={!!spent.early} label={t('earlierConnections')} spentLabel={t('noEarlier')} testid="earlier-connections" />
          {all.map(({ key: k, it }) => (
            <ConnectionCard key={k} it={it} shared={shared} base={date} selected={selected?.key === k} onOpen={() => openConnection(k)} fromPt={fromPtOf(it)} toPt={toPtOf(it)} />
          ))}
          <StepButton onClick={later} spent={!!spent.late} label={t('laterConnections')} spentLabel={t('noLater')} testid="later-connections" />
        </div>
      )}
      {estimatedNote}
      {pickFor && (
        <MapPicker
          shared={shared}
          title={pickFor === 'from' ? t('from') : t('to')}
          kind={pickFor}
          current={pickFor === 'from' ? from : to}
          onPick={(v) => (pickFor === 'from' ? setFrom(v) : setTo(v))}
          onClose={() => setPickFor(null)}
        />
      )}
    </div>
  );
}

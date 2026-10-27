import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, serviceDay } from '../../lib/holidays';
import { fmtMinutes } from '../../lib/time';
import { servicesFor } from '../../lib/network';
import { isoToYmd, ymdToIso, type PlannerForm } from '../../lib/plannerForm';
import { runSearch } from '../../lib/plannerSearch';
import { operatorOf } from '../../lib/operators';
import { sameTrip } from '../../lib/trips-store';
import type { Itinerary } from '../../lib/router';
import { endWalks } from '../Connection';
import { matchesType, type Shared } from '../common';

/** separates the search signature from the key of the opened connection in `shared.openConn` (a control character: never in the signature) */
const SEP = String.fromCharCode(1);
const scroller = () => document.getElementById('scroller');

/**
 * The planner's state apart from the form fields: the day and its trips, the search and its results, the connection opened in the detail
 * page, the "earlier / later connections" paging and the recent-trips bookkeeping. The search itself is `runSearch` (lib/plannerSearch.ts).
 */
export function usePlanner(shared: Shared) {
  const { planner, setPlanner, applied, commit } = shared;
  const { time, ops, directOnly, type } = planner;
  const patch = (p: Partial<PlannerForm>) => setPlanner((f) => ({ ...f, ...p }));

  // the connection opened in the detail page (null = the list of results)
  // a stored connection belongs to the search it was opened for: another search (or day, time, filter) starts at the list again
  const searchSig = JSON.stringify([applied.from, applied.to, planner.date, planner.time, planner.ops, planner.directOnly, planner.type, shared.ctx.school]);
  const { openConn, setOpenConn } = shared;
  const openKey = openConn?.startsWith(`${searchSig}${SEP}`) ? openConn.slice(searchSig.length + SEP.length) : null;
  const setOpenKey = (k: string | null) => setOpenConn(k === null ? null : `${searchSig}${SEP}${k}`);

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

  // the trips the search may use (line type / operator filter); one array per filter, so the router can reuse its per-destination index
  const only = useMemo(() => trips.filter((tr) => matchesType(tr.line, type) && (!ops.length || ops.includes(operatorOf(tr.line)))), [trips, type, ops]);
  // the search for a departure time (minutes from midnight of the chosen day, may pass 24:00): the results, and the "earlier / later" probes
  const run = useCallback((at: number) => (searched ? runSearch(shared.net, only, dFrom, dTo, at, directOnly) : null), [shared.net, only, dFrom, dTo, directOnly, searched]);
  const result = useMemo(() => run(departAt), [run, departAt]);

  // the point to walk from / to for a connection: a picked place or map point, or the picked stop when the bus boards / alights at another stop near it
  const fromPtOf = (it?: Itinerary) => dFrom.pt ?? (it && result?.ext.from && !result.ext.from.base.has(it.legs[0].trip.nodes[it.legs[0].fromPos]) ? result.ext.from.pt : undefined);
  const toPtOf = (it?: Itinerary) => {
    const last = it?.legs[it.legs.length - 1];
    return dTo.pt ?? (last && result?.ext.to && !result.ext.to.base.has(last.trip.nodes[last.toPos]) ? result.ext.to.pt : undefined);
  };
  const empty = !!result && !result.plan.direct.length && !result.plan.transfers.length;
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
  const listScroll = useRef(0);

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
  const startSearch = () => {
    commit({ from: planner.from, to: planner.to });
    shared.setPlannerView('results');
    window.scrollTo(0, 0);
    scroller()?.scrollTo(0, 0);
  };

  // a search that found stops at both ends goes to the recent trips (after a moment, so a passing pick is not stored)
  const { rememberTrip } = shared;
  const searchable = !!result && result.A > 0 && result.B > 0;
  useEffect(() => {
    if (!searchable) return;
    const id = setTimeout(() => rememberTrip({ from: dFrom, to: dTo }), 1200);
    return () => clearTimeout(id);
  }, [searchable, dFrom, dTo, rememberTrip]);
  const starred = !!dFrom.text.trim() && !!dTo.text.trim() && shared.favorites.some((f) => sameTrip(f, { from: dFrom, to: dTo }));

  return {
    patch,
    today,
    todayIso,
    date,
    dateIso,
    dayInfo,
    dFrom,
    dTo,
    searched,
    result,
    empty,
    all,
    anyEstimated,
    selected,
    opened,
    spent,
    fromPtOf,
    toPtOf,
    earlier,
    later,
    openConnection,
    closeConnection,
    startSearch,
    starred,
  };
}

export type PlannerState = ReturnType<typeof usePlanner>;

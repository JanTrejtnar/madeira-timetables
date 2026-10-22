import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pruneShapeCache, useDataset } from './data';
import { LANGS, LangContext, makeT, type Lang } from './i18n';
import { LangMenu } from './components/LangMenu';
import { SettingsTab } from './components/SettingsTab';
import { isFareCard, type FareCard } from './lib/fare';
import { isSchoolPeriod } from './lib/holidays';
import { nowInMadeira } from './lib/time';
import { DeparturesTab } from './components/DeparturesTab';
import type { RideWhen } from './components/common';
import { LineView } from './components/LineView';
import { PlannerTab } from './components/PlannerTab';
import { buildNetwork } from './lib/network';
import { SearchTab } from './components/SearchTab';
import { EmptyState, SkeletonCards, type RideEnds, type Shared } from './components/common';
import { Icon, type IconName } from './components/Icons';
import { RouteMap } from './components/RouteMap';
import { NetworkMap } from './components/NetworkMap';
import { addRecent, loadFavorites, loadRecent, saveFavorites, saveRecent, toggleFavorite as toggleFav, type SavedTrip } from './lib/trips-store';
import { useMedia } from './lib/hooks';
import { applyTheme, isTheme, type ThemePref } from './lib/theme';
import type { UserPos } from './lib/nearby';
import { formFromQuery, formToQuery, parseConnectionParam, settled, type PlannerForm } from './lib/plannerForm';
import type { MapFocus, MapLayer } from './types';

type Tab = 'search' | 'route' | 'map' | 'departures' | 'settings';

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable (private mode); preferences just don't persist */
    }
  },
};

function initialLang(): Lang {
  const saved = store.get('lang');
  if (saved && (LANGS as string[]).includes(saved)) return saved as Lang;
  // English unless the browser is set to Czech (or Portuguese)
  const nav = (navigator.languages?.[0] ?? navigator.language ?? '').slice(0, 2).toLowerCase();
  return nav === 'cs' || nav === 'pt' ? nav : 'en';
}

function parseHash(): { id: number; dir?: number; ride?: { from: number; to: number }; when?: RideWhen } | null {
  const m = location.hash.match(/^#\/line\/(\d+)(?:\/(\d+))?(?:\/(\d+)-(\d+))?(?:\?(.*))?/);
  if (!m) return null;
  // ?dep=07:35&date=2026-10-23: the departure the traveller searched for, selected in the line detail instead of "the next one"
  const q = new URLSearchParams(m[5] ?? '');
  const dep = q.get('dep');
  const date = q.get('date');
  const when = dep && /^\d{1,2}:\d{2}$/.test(dep) && m[3] !== undefined ? { dep, ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {}) } : undefined;
  return { id: +m[1], dir: m[2] !== undefined ? +m[2] : undefined, ...(m[3] !== undefined && +m[3] < +m[4] ? { ride: { from: +m[3], to: +m[4] } } : {}), ...(when ? { when } : {}) };
}

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const t = useMemo(() => makeT(lang), [lang]);
  const [tab, setTab] = useState<Tab>('route');
  const [route, setRoute] = useState(parseHash);
  // the planner's start / destination points of the leg that was opened (the hash only carries the ridden stretch)
  const [openConn, setOpenConn] = useState<string | null>(null);
  const [rideEnds, setRideEnds] = useState<RideEnds | undefined>();
  const [plannerView, setPlannerViewState] = useState<'form' | 'results'>(() => {
    const q = new URLSearchParams(location.search);
    return q.get('from') && q.get('to') ? 'results' : 'form';
  });
  const [now, setNow] = useState(() => nowInMadeira());
  // The school term is detected from today's date. A manual choice is only an override for the day it was made.
  const dayStamp = `${now.y}-${now.m}-${now.d}`;
  const [schoolOverride, setSchoolOverride] = useState<boolean | null>(() => {
    const [v, stamp] = (store.get('school') ?? '').split('|');
    const t = nowInMadeira();
    return stamp === `${t.y}-${t.m}-${t.d}` && (v === '1' || v === '0') ? v === '1' : null;
  });
  const [overrideDay, setOverrideDay] = useState(dayStamp);
  const [fareCard, setFareCardState] = useState<FareCard>(() => {
    const v = store.get('fareCard');
    return isFareCard(v) ? v : 'none';
  });
  const [theme, setThemeState] = useState<ThemePref>(() => {
    const v = store.get('theme');
    return isTheme(v) ? v : 'system';
  });
  const setTheme = useCallback((v: ThemePref) => {
    setThemeState(v);
    store.set('theme', v);
  }, []);
  useEffect(() => {
    void pruneShapeCache();
  }, []);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);
  const setFareCard = useCallback((c: FareCard) => {
    setFareCardState(c);
    store.set('fareCard', c);
  }, []);
  const { data, index, error } = useDataset();
  const desktop = useMedia('(min-width: 1024px)');
  const [mapLayers, setMapLayers] = useState<MapLayer[] | null>(null);
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  const mapStopHandler = useRef<((index: number) => void) | null>(null);
  const setMapStopHandler = useCallback((fn: ((index: number) => void) | null) => { mapStopHandler.current = fn; }, []);
  const onMapStop = useCallback((i: number) => mapStopHandler.current?.(i), []);

  const [userPos, setUserPos] = useState<UserPos | null>(null);
  const [geo, setGeo] = useState<Shared['geo']>('idle');
  // planner form: kept here so it survives opening a line and going back, and mirrored into the URL query
  const [planner, setPlanner] = useState<PlannerForm>(() => formFromQuery(location.search));
  // what the results and the map are computed for: follows a pick (suggestion, map point) at once, typed text only on Enter
  const [applied, setApplied] = useState<Shared['applied']>(() => ({ from: planner.from, to: planner.to }));
  useEffect(() => {
    setApplied((a) => {
      const from = settled(planner.from) ? planner.from : a.from;
      const to = settled(planner.to) ? planner.to : a.to;
      return from === a.from && to === a.to ? a : { from, to };
    });
  }, [planner.from, planner.to]);
  const [pendingConn, setPendingConn] = useState(() => parseConnectionParam(new URLSearchParams(location.search).get('c')));
  const clearPendingConn = useCallback(() => setPendingConn(null), []);
  const commit = useCallback((v: Partial<Shared['applied']>) => setApplied((a) => ({ ...a, ...v })), []);
  useEffect(() => {
    const q = formToQuery({ ...planner, from: applied.from, to: applied.to });
    const url = `${location.pathname}${q ? `?${q}` : ''}${location.hash}`;
    if (url !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, '', url);
  }, [planner, applied]);
  // recent searches and starred connections (localStorage)
  const [recent, setRecent] = useState<SavedTrip[]>(loadRecent);
  const [favorites, setFavorites] = useState<SavedTrip[]>(loadFavorites);
  const rememberTrip = useCallback((trip: Pick<SavedTrip, 'from' | 'to'>) => {
    setRecent((list) => {
      const next = addRecent(list, trip);
      saveRecent(next);
      return next;
    });
  }, []);
  const toggleFavorite = useCallback((trip: Pick<SavedTrip, 'from' | 'to'>) => {
    setFavorites((list) => {
      const next = toggleFav(list, trip);
      saveFavorites(next);
      return next;
    });
  }, []);
  const clearRecent = useCallback(() => {
    setRecent([]);
    saveRecent([]);
  }, []);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) return setGeo('unsupported');
    setGeo('busy');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setUserPos((prev) => ({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, seq: (prev?.seq ?? 0) + 1 }));
        setGeo('idle');
      },
      (e) => setGeo(e.code === 1 ? 'denied' : 'error'),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    store.set('lang', lang);
  }, [lang]);
  useEffect(() => {
    const id = setInterval(() => setNow(nowInMadeira()), 15_000);
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => {
      clearInterval(id);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  const school = (schoolOverride !== null && overrideDay === dayStamp ? schoolOverride : null) ?? isSchoolPeriod(now);
  const autoSchool = isSchoolPeriod(now);
  const ctx = useMemo(() => ({ now, school, municipalities: ['Funchal'] as const }), [now, school]);
  const net = useMemo(() => (data ? buildNetwork(data.lines, data.terminalWalks) : null), [data]);
  const shared: Shared | null = useMemo(
    () =>
      data && net
        ? {
            ctx,
            lines: data.lines,
            net,
            openLine: (id, dir, ride, ends, when) => {
              setRideEnds(ends);
              location.hash = `#/line/${id}${dir !== undefined ? `/${dir}` : ''}${dir !== undefined && ride ? `/${ride.from}-${ride.to}` : ''}${dir !== undefined && ride && when ? `?dep=${when.dep}${when.date ? `&date=${when.date}` : ''}` : ''}`;
            },
            openConn,
            setOpenConn,
            fareCard,
            plannerView,
            setPlannerView: setPlannerViewState,
            desktop,
            setMap: setMapLayers,
            setMapFocus,
            setMapStopHandler,
            userPos,
            geo,
            locate,
            planner,
            applied,
            commit,
            setPlanner,
            pendingConn,
            clearPendingConn,
            useAsFrom: (name, key) => {
              setOpenConn(null);
              setPlannerViewState('form');
              setPlanner((p) => ({ ...p, from: { text: name, key } }));
              setTab('route');
              if (location.hash) location.hash = '';
            },
            useStopAs: (kind, name, key) => {
              setOpenConn(null);
              setPlannerViewState('form');
              setPlanner((p) => ({ ...p, [kind]: { text: name, key } }));
              setTab('route');
              if (location.hash) location.hash = '';
            },
            recent,
            favorites,
            toggleFavorite,
            rememberTrip,
            clearRecent,
            useTrip: (trip) => {
              setOpenConn(null);
              setPlannerViewState('results');
              setPlanner((p) => ({ ...p, from: trip.from, to: trip.to }));
              setApplied({ from: trip.from, to: trip.to });
              setTab('route');
              if (location.hash) location.hash = '';
            },
          }
        : null,
    [data, net, ctx, openConn, fareCard, plannerView, desktop, userPos, geo, locate, planner, applied, commit, pendingConn, clearPendingConn, recent, favorites, toggleFavorite, rememberTrip, clearRecent],
  );

  // height of the sticky header: pages put their own sticky bars right under it
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const line = route && data ? data.lines.find((l) => l.id === route.id) : undefined;
  // desktop: the big map sits beside the panel only when there is something to show on it (a line, the "Map" tab, search results);
  // before a search the start page is a single centred column
  const splitView = desktop && (!!route || tab === 'map' || (tab === 'route' && plannerView === 'results'));

  // where the settings page was opened from: its icon takes the reader back there (the tab, a line detail, a planner connection)
  const cameFrom = useRef<{ tab: Tab; hash: string; openConn: string | null } | null>(null);
  const selectTab = (k: Tab) => {
    cameFrom.current = null;
    setOpenConn(null);
    setTab(k);
    if (route) location.hash = '';
  };
  const toggleSettings = () => {
    if (tab === 'settings' && !route) {
      const back = cameFrom.current ?? { tab: 'route' as Tab, hash: '', openConn: null };
      cameFrom.current = null;
      setTab(back.tab);
      setOpenConn(back.openConn);
      if (back.hash) location.hash = back.hash;
      return;
    }
    cameFrom.current = { tab, hash: route ? location.hash : '', openConn };
    setOpenConn(null);
    setTab('settings');
    if (route) location.hash = '';
  };
  const tabs: { key: Tab; icon: IconName; label: string }[] = [
    { key: 'route', icon: 'route', label: t('tabRoute') },
    { key: 'map', icon: 'map', label: t('tabMap') },
    { key: 'search', icon: 'bus', label: t('tabSearch') },
    { key: 'departures', icon: 'clock', label: t('tabDepartures') },
  ];

  return (
    <LangContext.Provider value={{ lang, t }}>
      <div className={`min-h-dvh lg:grid lg:h-dvh lg:overflow-hidden ${splitView ? 'lg:grid-cols-[minmax(380px,440px)_1fr]' : 'lg:grid-cols-1'}`} data-testid="layout" data-split={splitView}>
        <aside className={`mx-auto flex w-full max-w-2xl flex-col lg:h-dvh lg:overflow-hidden lg:bg-slate-50 dark:lg:bg-slate-950 ${splitView ? 'lg:mx-0 lg:max-w-none lg:border-r lg:border-slate-200/70 dark:lg:border-slate-800' : 'lg:border-x lg:border-slate-200/70 dark:lg:border-slate-800'}`}>
          <header ref={headerRef} className="sticky top-0 z-40 shrink-0 border-b border-slate-200/70 bg-white/90 px-4 pb-3 pt-safe backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 lg:static lg:bg-white lg:backdrop-blur-none dark:lg:bg-slate-900">
            <div className="flex items-center justify-between gap-2 pt-3">
              <h1 className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
                <span className="flex size-8 items-center justify-center rounded-xl bg-sky-600 text-white">
                  <Icon name="bus" className="size-5" />
                </span>
                {t('appName')}
              </h1>
              <div className="flex items-center gap-1.5">
                <LangMenu lang={lang} onChange={setLang} />
                <button
                  type="button"
                  onClick={toggleSettings}
                  aria-label={t('settings')}
                  title={t('settings')}
                  aria-current={tab === 'settings' && !route}
                  data-testid="open-settings"
                  className={`flex size-9 items-center justify-center rounded-full transition-colors ${tab === 'settings' && !route ? 'bg-slate-100 text-sky-700 dark:bg-slate-800 dark:text-sky-300' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800'}`}
                >
                  <Icon name="settings" className="size-5" />
                </button>
              </div>
            </div>
            <nav className="mt-3 hidden grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800 lg:grid" aria-label="Tabs">
              {tabs.map((x) => (
                <button
                  key={x.key}
                  onClick={() => selectTab(x.key)}
                  aria-current={x.key === tab && !route}
                  className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors ${
                    x.key === tab && !route ? 'bg-white text-sky-700 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon name={x.icon} className="size-4" />
                  {x.label}
                </button>
              ))}
            </nav>
          </header>

          {!online && (
            <div role="status" className="shrink-0 bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">
              {t('offlineBanner')}
            </div>
          )}
          <main id="scroller" className="flex-1 px-4 pb-28 pt-4 lg:min-h-0 lg:overflow-y-auto lg:pb-6">
            {error && <EmptyState icon="alert" tone="warn" title={t('loadError')} />}
            {!data && !error && (
              <div aria-label={t('loading')}>
                <SkeletonCards n={5} />
              </div>
            )}
            {data && index && shared && (
              <>
                {route && line ? (
                  <LineView line={line} initialDir={route.dir} initialRide={route.ride} initialWhen={route.when} initialEnds={route.ride ? rideEnds : undefined} shared={shared} onBack={() => (history.length > 1 ? history.back() : (location.hash = ''))} />
                ) : (
                  <>
                    {tab === 'map' && !desktop && (
                      <div className="-mx-4 -mb-28 -mt-4 h-[calc(100dvh-8.75rem-env(safe-area-inset-bottom))] min-h-96" data-testid="map-tab">
                        <NetworkMap shared={shared} fill />
                      </div>
                    )}
                    {tab === 'map' && desktop && <EmptyState icon="map" title={t('mapTabTitle')} body={t('mapTabBody')} />}
                    {tab === 'search' && <SearchTab shared={shared} index={index} />}
                    {tab === 'route' && <PlannerTab shared={shared} />}
                    {tab === 'departures' && <DeparturesTab shared={shared} />}
                    {tab === 'settings' && (
                      <SettingsTab
                        school={school}
                        autoSchool={autoSchool}
                        onSchool={(v) => {
                          setSchoolOverride(v);
                          setOverrideDay(dayStamp);
                          store.set('school', `${v ? '1' : '0'}|${dayStamp}`);
                        }}
                        onSchoolReset={() => {
                          setSchoolOverride(null);
                          store.set('school', '');
                        }}
                        fareCard={fareCard}
                        onFareCard={setFareCard}
                        theme={theme}
                        onTheme={setTheme}
                        generatedAt={data.generatedAt}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </main>
        </aside>

        {splitView && (
          <div className="relative h-dvh bg-slate-200 dark:bg-slate-800">
            {mapLayers || !shared ? (
              <RouteMap layers={mapLayers ?? []} focus={mapFocus} onStopClick={onMapStop} me={userPos} onLocate={locate} locating={geo === 'busy'} fill />
            ) : (
              <NetworkMap shared={shared} fill />
            )}
          </div>
        )}

        <nav
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-200/70 bg-white/90 pb-safe backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 lg:hidden"
          aria-label="Tabs"
        >
          {tabs.map((x) => {
            const active = x.key === tab && !route;
            return (
              <button
                key={x.key}
                onClick={() => selectTab(x.key)}
                aria-current={active}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${active ? 'text-sky-600 dark:text-sky-400' : 'text-slate-500 dark:text-slate-400'}`}
              >
                <Icon name={x.icon} className="size-6" strokeWidth={active ? 2 : 1.5} />
                {x.label}
              </button>
            );
          })}
        </nav>
      </div>
    </LangContext.Provider>
  );
}

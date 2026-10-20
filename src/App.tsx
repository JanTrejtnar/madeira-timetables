import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDataset } from './data';
import { LANGS, LangContext, makeT, type Lang } from './i18n';
import { isSchoolPeriod, serviceDay } from './lib/holidays';
import { nowInMadeira } from './lib/time';
import { DeparturesTab } from './components/DeparturesTab';
import { LineView } from './components/LineView';
import { PlannerTab } from './components/PlannerTab';
import { buildNetwork } from './lib/network';
import { SearchTab } from './components/SearchTab';
import { EmptyState, SkeletonCards, type Shared } from './components/common';
import { Icon, type IconName } from './components/Icons';
import { RouteMap } from './components/RouteMap';
import { useMedia } from './lib/hooks';
import type { UserPos } from './lib/nearby';
import type { MapFocus, MapLayer } from './types';

type Tab = 'search' | 'route' | 'departures';

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
  const nav = navigator.language.slice(0, 2);
  return nav === 'pt' || nav === 'en' ? nav : 'cs';
}

function parseHash(): { id: number; dir?: number } | null {
  const m = location.hash.match(/^#\/line\/(\d+)(?:\/(\d+))?/);
  return m ? { id: +m[1], dir: m[2] !== undefined ? +m[2] : undefined } : null;
}

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const t = useMemo(() => makeT(lang), [lang]);
  const [tab, setTab] = useState<Tab>('route');
  const [route, setRoute] = useState(parseHash);
  const [now, setNow] = useState(() => nowInMadeira());
  // The school term is detected from today's date. A manual choice is only an override for the day it was made.
  const dayStamp = `${now.y}-${now.m}-${now.d}`;
  const [schoolOverride, setSchoolOverride] = useState<boolean | null>(() => {
    const [v, stamp] = (store.get('school') ?? '').split('|');
    const t = nowInMadeira();
    return stamp === `${t.y}-${t.m}-${t.d}` && (v === '1' || v === '0') ? v === '1' : null;
  });
  const [overrideDay, setOverrideDay] = useState(dayStamp);
  const { data, index, error } = useDataset();
  const desktop = useMedia('(min-width: 1024px)');
  const [mapLayers, setMapLayers] = useState<MapLayer[] | null>(null);
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);

  const [userPos, setUserPos] = useState<UserPos | null>(null);
  const [geo, setGeo] = useState<Shared['geo']>('idle');
  const [plannerFrom, setPlannerFrom] = useState<Shared['plannerFrom']>(null);
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
  const net = useMemo(() => (data ? buildNetwork(data.lines) : null), [data]);
  const shared: Shared | null = useMemo(
    () =>
      data && net
        ? {
            ctx,
            lines: data.lines,
            net,
            openLine: (id, dir) => {
              location.hash = `#/line/${id}${dir !== undefined ? `/${dir}` : ''}`;
            },
            desktop,
            setMap: setMapLayers,
            setMapFocus,
            userPos,
            geo,
            locate,
            plannerFrom,
            useAsFrom: (name, key) => {
              setPlannerFrom({ text: name, key, seq: Date.now() });
              setTab('route');
              if (location.hash) location.hash = '';
            },
          }
        : null,
    [data, net, ctx, desktop, userPos, geo, locate, plannerFrom],
  );

  const today = serviceDay(now);
  const dayName = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(now.y, now.m - 1, now.d)));
  const hhmm = `${String(Math.floor(now.minutes / 60)).padStart(2, '0')}:${String(now.minutes % 60).padStart(2, '0')}`;
  const todayLabel =
    today.type === null
      ? t('noService')
      : t(`day_${today.type}`) +
        (today.reason === 'holiday' ? ` · ${t('reason_holiday')}: ${today.holiday?.name}` : today.reason === 'saturday-rule' ? ` · ${today.special}` : '');

  const line = route && data ? data.lines.find((l) => l.id === route.id) : undefined;

  const selectTab = (k: Tab) => {
    setTab(k);
    if (route) location.hash = '';
  };
  const tabs: { key: Tab; icon: IconName; label: string }[] = [
    { key: 'route', icon: 'route', label: t('tabRoute') },
    { key: 'search', icon: 'search', label: t('tabSearch') },
    { key: 'departures', icon: 'clock', label: t('tabDepartures') },
  ];

  return (
    <LangContext.Provider value={{ lang, t }}>
      <div className="min-h-dvh lg:grid lg:h-dvh lg:grid-cols-[minmax(380px,440px)_1fr] lg:overflow-hidden">
        <aside className="mx-auto flex w-full max-w-2xl flex-col lg:mx-0 lg:h-dvh lg:max-w-none lg:overflow-hidden lg:border-r lg:border-slate-200/70 lg:bg-slate-50 dark:lg:border-slate-800 dark:lg:bg-slate-950">
          <header className="sticky top-0 z-40 shrink-0 border-b border-slate-200/70 bg-white/90 px-4 pb-3 pt-safe backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 lg:static lg:bg-white lg:backdrop-blur-none dark:lg:bg-slate-900">
            <div className="flex items-center justify-between gap-2 pt-3">
              <h1 className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
                <span className="flex size-8 items-center justify-center rounded-xl bg-sky-600 text-white">
                  <Icon name="bus" className="size-5" />
                </span>
                {t('appName')}
              </h1>
              <div className="inline-flex rounded-full bg-slate-100 p-0.5 dark:bg-slate-800" role="group" aria-label={t('language')}>
                {LANGS.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    aria-pressed={l === lang}
                    className={`h-8 min-w-9 rounded-full px-2 text-xs font-semibold uppercase transition-colors ${
                      l === lang ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{hhmm}</span>
              <span className="capitalize">{dayName}</span>
              <span className="min-w-0">
                {t('timetableToday')}: <b className="font-semibold text-slate-700 dark:text-slate-200">{todayLabel}</b>
              </span>
              <label className="ml-auto inline-flex min-h-8 cursor-pointer items-center gap-2" title={t('schoolHint')}>
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={school}
                  onChange={(e) => {
                    setSchoolOverride(e.target.checked);
                    setOverrideDay(dayStamp);
                    store.set('school', `${e.target.checked ? '1' : '0'}|${dayStamp}`);
                  }}
                />
                <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-sky-600 peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500 dark:bg-slate-600" />
                {school ? t('schoolPeriod') : t('schoolHolidays')}
                {school === autoSchool ? <span className="text-slate-400">({t('schoolAuto')})</span> : null}
              </label>
              {school !== autoSchool && (
                <button
                  className="min-h-8 rounded-md px-1.5 text-sky-700 underline dark:text-sky-300"
                  onClick={() => {
                    setSchoolOverride(null);
                    store.set('school', '');
                  }}
                >
                  {t('schoolReset')}
                </button>
              )}
            </div>
            <nav className="mt-3 hidden grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800 lg:grid" aria-label="Tabs">
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
                  <LineView line={line} initialDir={route.dir} shared={shared} onBack={() => (history.length > 1 ? history.back() : (location.hash = ''))} />
                ) : (
                  <>
                    {tab === 'search' && <SearchTab shared={shared} index={index} />}
                    {tab === 'route' && <PlannerTab shared={shared} />}
                    {tab === 'departures' && <DeparturesTab shared={shared} />}
                  </>
                )}
                <p className="mt-8 text-center text-xs text-slate-400">
                  {t('dataFrom')} {data.generatedAt.slice(0, 10)}
                </p>
              </>
            )}
          </main>
        </aside>

        {desktop && (
          <div className="relative h-dvh bg-slate-200 dark:bg-slate-800">
            <RouteMap layers={mapLayers ?? []} focus={mapFocus} me={userPos} onLocate={locate} locating={geo === 'busy'} fill />
            {!mapLayers && (
              <div className="pointer-events-none absolute left-16 top-4 z-10 flex max-w-xs items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/90 px-4 py-3 text-sm text-slate-600 shadow-lg backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/90 dark:text-slate-300">
                <Icon name="map" className="size-5 shrink-0 text-sky-600" />
                {t('mapIdle')}
              </div>
            )}
          </div>
        )}

        <nav
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-slate-200/70 bg-white/90 pb-safe backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 lg:hidden"
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

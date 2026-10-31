import { useT } from '../i18n';
import { geoDeniedText } from '../lib/geoHelp';
import type { LocStatus } from '../lib/liveLocation';

/** Round map button: centre on my position (starts the live watch); filled while the map follows the position. */
export function LocateFab({ status, following, onClick, className = '' }: { status: LocStatus; following: boolean; onClick: () => void; className?: string }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === 'busy'}
      aria-label={t('locateMe')}
      aria-pressed={following}
      title={t('locateMe')}
      data-testid="locate-fab"
      className={`absolute z-500 flex size-11 items-center justify-center rounded-full shadow-md ring-1 disabled:opacity-60 ${following ? 'bg-sky-600 text-white ring-sky-700' : 'bg-white text-sky-700 ring-slate-200 dark:bg-slate-900 dark:text-sky-300 dark:ring-slate-700'} ${className}`}
    >
      <svg viewBox="0 0 24 24" className={`size-5 ${status === 'busy' ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
        <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
      </svg>
    </button>
  );
}

/** Why the position is missing; for a denied permission with the steps for this device. */
export function LocateHint({ status }: { status: LocStatus }) {
  const { t } = useT();
  const text = status === 'denied' ? geoDeniedText(t) : status === 'error' ? t('geoError') : status === 'unsupported' ? t('geoUnsupported') : null;
  if (!text) return null;
  return (
    <p role="alert" data-testid="locate-hint" className="absolute left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] bottom-[max(2rem,calc(env(safe-area-inset-bottom)+0.75rem))] z-500 rounded-xl bg-white/95 px-3 py-2 text-xs leading-5 text-amber-800 shadow-md ring-1 ring-amber-200 dark:bg-slate-900/95 dark:text-amber-200 dark:ring-amber-400/30 lg:right-auto lg:max-w-sm">
      {text}
    </p>
  );
}

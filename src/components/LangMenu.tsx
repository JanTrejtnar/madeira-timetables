import { useEffect, useRef, useState } from 'react';
import { LANGS, useT, type Key, type Lang } from '../i18n';
import { Icon } from './Icons';

/** Flags as inline SVG: Windows has no flag emoji, and the offline app needs no image files. */
export function Flag({ lang, className = 'h-4 w-6' }: { lang: Lang; className?: string }) {
  return (
    <svg viewBox="0 0 24 16" className={`${className} shrink-0 rounded-[3px] ring-1 ring-black/10`} aria-hidden="true">
      <defs>
        <clipPath id={`flag-${lang}`}>
          <rect width="24" height="16" rx="2" />
        </clipPath>
      </defs>
      <g clipPath={`url(#flag-${lang})`}>
        {lang === 'cs' && (
          <>
            <rect width="24" height="8" fill="#fff" />
            <rect y="8" width="24" height="8" fill="#d7141a" />
            <path d="M0 0 12 8 0 16Z" fill="#11457e" />
          </>
        )}
        {lang === 'en' && (
          <>
            <rect width="24" height="16" fill="#012169" />
            <path d="M0 0 24 16M24 0 0 16" stroke="#fff" strokeWidth="3.2" />
            <path d="M0 0 24 16M24 0 0 16" stroke="#c8102e" strokeWidth="1.2" />
            <path d="M12 0v16M0 8h24" stroke="#fff" strokeWidth="5.2" />
            <path d="M12 0v16M0 8h24" stroke="#c8102e" strokeWidth="3" />
          </>
        )}
        {lang === 'pt' && (
          <>
            <rect width="24" height="16" fill="#ff0000" />
            <rect width="9.6" height="16" fill="#006600" />
            <circle cx="9.6" cy="8" r="3.1" fill="#ffcc00" />
            <circle cx="9.6" cy="8" r="2" fill="#fff" />
            <rect x="8.4" y="6.6" width="2.4" height="2.8" rx="0.6" fill="#ff0000" />
          </>
        )}
      </g>
    </svg>
  );
}

/** Language dropdown: the current flag and code, the list opens below with a flag and the name of every language. */
export function LangMenu({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative" data-testid="lang-menu">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('language')}
        className="flex h-9 items-center gap-1.5 rounded-full bg-slate-100 pl-2.5 pr-2 text-xs font-semibold uppercase text-slate-700 transition-colors hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        <Flag lang={lang} />
        {lang}
        <Icon name="chevronDown" className={`size-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2.25} />
      </button>
      {open && (
        <ul role="listbox" aria-label={t('language')} className="absolute right-0 top-full z-50 mt-2 min-w-44 overflow-hidden rounded-2xl border border-slate-200/70 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {LANGS.map((l) => (
            <li key={l} role="option" aria-selected={l === lang}>
              <button
                type="button"
                onClick={() => {
                  onChange(l);
                  setOpen(false);
                }}
                className={`flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${l === lang ? 'font-semibold' : ''}`}
              >
                <Flag lang={l} className="h-4 w-6" />
                <span className="flex-1">{t(`langName_${l}` as Key)}</span>
                {l === lang && <Icon name="check" className="size-4 text-sky-600" strokeWidth={2.25} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

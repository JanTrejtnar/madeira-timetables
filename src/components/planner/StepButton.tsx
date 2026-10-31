/** "← Earlier connections" / "Later connections →" above and below the list; greyed out with a note once nothing more was found, a spinner while the probe runs. */
export function StepButton({ onClick, spent, busy, label, spentLabel, testid }: { onClick: () => void; spent: boolean; busy?: boolean; label: string; spentLabel: string; testid: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={spent || busy}
      aria-busy={busy || undefined}
      data-testid={testid}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 disabled:text-slate-500 disabled:hover:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-slate-800 dark:disabled:text-slate-400"
    >
      {busy && <span className="size-4 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" aria-hidden="true" />}
      {spent ? spentLabel : label}
    </button>
  );
}

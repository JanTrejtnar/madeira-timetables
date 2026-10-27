/** "← Earlier connections" / "Later connections →" above and below the list; greyed out with a note once nothing more was found. */
export function StepButton({ onClick, spent, label, spentLabel, testid }: { onClick: () => void; spent: boolean; label: string; spentLabel: string; testid: string }) {
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

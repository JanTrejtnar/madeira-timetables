import { Component, type ReactNode } from 'react';
import { useT } from '../i18n';
import { EmptyState } from './common';

/** The page shown instead of a blank screen when the timetables cannot be loaded, or the screen crashed on data it did not expect. */
export function DataUnavailable() {
  const { t } = useT();
  return (
    <div role="alert" data-testid="data-unavailable">
      <EmptyState icon="alert" tone="warn" title={t('dataUnavailableTitle')} body={t('dataUnavailableBody')} />
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => location.reload()}
          className="h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-slate-800"
        >
          {t('dataReload')}
        </button>
      </div>
    </div>
  );
}

/** A crash inside one page (not a data problem): says so, and offers another try or the start page. */
function SomethingWrong({ onRetry }: { onRetry: () => void }) {
  const { t } = useT();
  const btn =
    'h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-slate-800';
  return (
    <div role="alert" data-testid="page-error">
      <EmptyState icon="alert" tone="warn" title={t('errorTitle')} body={t('errorBody')} />
      <div className="flex justify-center gap-2">
        <button type="button" onClick={onRetry} className={btn}>
          {t('dataReload')}
        </button>
        <button
          type="button"
          onClick={() => {
            location.hash = '#/route';
            onRetry();
          }}
          className={btn}
        >
          {t('errorHome')}
        </button>
      </div>
    </div>
  );
}

/** A small notice in the place of a part that failed to load (a map chunk that is not cached offline), with a retry. */
function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useT();
  return (
    <div role="alert" className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-3 rounded-2xl bg-slate-100 p-4 text-center text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-sky-700 dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300"
      >
        {t('dataReload')}
      </button>
    </div>
  );
}

/**
 * Catches an error thrown while rendering its children; `resetKey` changing (another page) gives them a fresh try.
 * `variant`: "data" = the timetables are unavailable (the default, the outermost boundary), "page" = this page crashed,
 * "inline" = a part of a page failed (`message`), e.g. a lazily loaded map.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string; variant?: 'data' | 'page' | 'inline'; message?: string; onRetry?: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Rendering failed:', error);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  private retry = () => {
    this.props.onRetry?.();
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const { variant = 'data', message } = this.props;
    if (variant === 'page') return <SomethingWrong onRetry={this.retry} />;
    if (variant === 'inline') return <InlineError message={message ?? ''} onRetry={this.retry} />;
    return <DataUnavailable />;
  }
}

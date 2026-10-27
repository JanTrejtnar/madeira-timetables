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

/** Catches an error thrown while rendering its children; `resetKey` changing (another page) gives them a fresh try. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
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

  render() {
    return this.state.failed ? <DataUnavailable /> : this.props.children;
  }
}

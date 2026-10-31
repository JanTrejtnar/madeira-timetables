import { useEffect, useRef } from 'react';

let seq = 0;

/**
 * While an overlay (a dialog, the map picker) is open it owns one history entry, so the phone's Back button / gesture closes the overlay
 * instead of leaving the page. Closing it any other way (a button, Escape) removes that entry again.
 * `onClose` is called when Back closed the overlay; `enabled` switches the entry off (e.g. on a desktop, where the popover is not modal).
 */
export function useBackToClose(open: boolean, onClose: () => void, enabled = true): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // the id of the entry this overlay pushed and the timer of its deferred removal; kept across React's dev-mode remount of effects
  const entry = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!open || !enabled) return;
    clearTimeout(timer.current);
    if (entry.current === null) {
      entry.current = ++seq;
      history.pushState({ ...history.state, overlay: entry.current }, '');
    }
    const mine = entry.current;
    const onPop = () => {
      if (history.state?.overlay === mine) return;
      entry.current = null;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // deferred: a remount in the same tick keeps the entry instead of popping and pushing again
      timer.current = setTimeout(() => {
        if (entry.current === mine && history.state?.overlay === mine) history.back();
        if (entry.current === mine) entry.current = null;
      }, 0);
    };
  }, [open, enabled]);
}

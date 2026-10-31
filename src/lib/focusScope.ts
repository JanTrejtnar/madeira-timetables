import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus handling of a dialog: while `active` the focus moves into `ref` (its first control, else the element itself), with `trap` Tab
 * and Shift+Tab wrap around inside it, and when the dialog closes the focus goes back to the element that had it before.
 */
export function useFocusScope(ref: RefObject<HTMLElement | null>, active: boolean, trap = true): void {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!root.contains(document.activeElement)) {
      const first = items()[0];
      if (first) first.focus({ preventScroll: true });
      else {
        root.tabIndex = -1;
        root.focus({ preventScroll: true });
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (!trap || e.key !== 'Tab') return;
      const list = items();
      if (!list.length) return e.preventDefault();
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) (e.preventDefault(), first.focus());
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      if (before && before !== document.body && before.isConnected) before.focus({ preventScroll: true });
    };
  }, [ref, active, trap]);
}

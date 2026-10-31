/** Colour scheme preference: follows the system until the traveller picks one (kept in the browser). */
export type ThemePref = 'system' | 'light' | 'dark';
export const THEMES: ThemePref[] = ['system', 'light', 'dark'];
export const isTheme = (v: unknown): v is ThemePref => THEMES.includes(v as ThemePref);

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Puts the `dark` class on <html> (the Tailwind `dark:` variant and the CSS in index.css key off it). */
export function applyTheme(pref: ThemePref): void {
  const dark = pref === 'dark' || (pref === 'system' && systemDark());
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  // the colour of the phone's status bar / browser toolbar follows the header
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f172a' : '#ffffff');
}

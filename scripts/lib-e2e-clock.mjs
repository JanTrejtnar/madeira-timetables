// The e2e scripts must give the same result at 02:00 as at 20:00: the app picks the direction of a line, the
// "now" departures and the default search time from the clock, so every page they open runs on a fixed one.
// Friday 2026-10-23 07:00 Madeira time (WEST, UTC+1); the clock keeps ticking from there.
export const FIXED_NOW = '2026-10-23T06:00:00Z';

function install(start) {
  const Real = Date;
  const t0 = Real.now();
  const now = () => start + (Real.now() - t0);
  class FakeDate extends Real {
    constructor(...a) {
      if (a.length === 0) super(now());
      else super(...a);
    }
    static now() {
      return now();
    }
  }
  globalThis.Date = FakeDate;
}

/** Every page of the browser (and of the contexts it creates later) starts with the fixed clock. */
export function freezeClock(browser, iso = FIXED_NOW) {
  const start = Date.parse(iso);
  const patch = (owner) => {
    const open = owner.newPage.bind(owner);
    owner.newPage = async (...args) => {
      const page = await open(...args);
      await page.evaluateOnNewDocument(install, start);
      return page;
    };
    return owner;
  };
  patch(browser);
  const create = browser.createBrowserContext?.bind(browser);
  if (create) browser.createBrowserContext = async (...args) => patch(await create(...args));
  return browser;
}

/** Waits until the dev server answers (Vite may still be starting or restarting); throws after `timeoutMs`. */
export async function waitForServer(url = process.argv[2] ?? 'http://localhost:5173/', timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = String(e.cause?.code ?? e.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server ${url} not reachable after ${timeoutMs / 1000} s (${last}); start it with: npx vite --port 5173`);
}

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dictionaries, type Lang } from '../src/i18n';

describe('translations', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  it('every language has the same keys', () => {
    const keys = (l: Lang) => Object.keys(dictionaries[l]).sort();
    expect(keys('en')).toEqual(keys('cs'));
    expect(keys('pt')).toEqual(keys('cs'));
  });
  it('every language uses the placeholders of the Czech text (a missing {name} would print a half sentence)', () => {
    for (const [k, cs] of Object.entries(dictionaries.cs)) for (const l of ['en', 'pt'] as const) expect(placeholders((dictionaries[l] as Record<string, string>)[k]!), `${l}.${k}`).toBe(placeholders(cs));
  });
  it('a translation is not left in Czech: an English or Portuguese text has no letter that only Czech uses', () => {
    const czech = /[ěščřžůťďňĚŠČŘŽŮŤĎŇ]/;
    for (const l of ['en', 'pt'] as const) for (const [k, v] of Object.entries(dictionaries[l]).filter(([k]) => !k.startsWith('langName_'))) expect(czech.test(v), `${l}.${k}: ${v}`).toBe(false);
  });
  it('the Czech wording of a name made in code lives in the dictionary, not in a component', () => {
    const dir = new URL('../src/', import.meta.url);
    const czech = /[ěščřžůťďňĚŠČŘŽŮŤĎŇ]/;
    const allowed = new Set(['i18n.ts', 'lib/notes.ts', 'lib/notes-extra.ts', 'lib/aliases.ts', 'lib/operators.ts', 'lib/text.ts' /* the legacy labels of older saves */]);
    const offenders: string[] = [];
    const walk = (d: URL) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const u = new URL(e.name + (e.isDirectory() ? '/' : ''), d);
        if (e.isDirectory()) walk(u);
        else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && !allowed.has(u.pathname.slice(dir.pathname.length))) {
          const code = readFileSync(u, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
          if (czech.test(code)) offenders.push(u.pathname.slice(dir.pathname.length));
        }
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });
});

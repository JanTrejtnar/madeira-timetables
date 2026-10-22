import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe.skipIf(!existsSync('data/schedules.json'))('legend notes', () => {
  it('none is cut off by the PDF parser once data/note-fixes.json is applied (scripts/audit-notes.mjs)', () => {
    // exits with 1 and lists the line and note when a legend text ends in a dash / preposition or a code has no text
    const out = execFileSync(process.execPath, ['scripts/audit-notes.mjs', '--strict'], { encoding: 'utf8' });
    expect(out).toContain('0 lines with suspicious notes');
  });
});

// Safety net for the data file: a string with a leftover HTML entity ("D&#039;Abra") is decoded before it is shown.
// build:data already cleans the data; this runs on the raw JSON text, so the cost is one regex pass.
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };

/** Decodes entities in JSON text; the result is still valid JSON (a decoded quote or backslash is escaped). */
export function decodeEntitiesInJson(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    let ch: string | undefined;
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      ch = code > 31 && code < 0x110000 ? String.fromCodePoint(code) : undefined;
    } else ch = e.toLowerCase() === 'quot' ? '"' : NAMED[e.toLowerCase()];
    if (ch === undefined) return m;
    return ch === '"' || ch === '\\' ? '\\' + ch : ch;
  });
}

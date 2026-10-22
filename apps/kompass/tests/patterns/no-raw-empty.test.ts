import { describe, expect, it } from 'vitest';
import {
  allowlistHygiene,
  checkCountedAllowlist,
  type CountedAllowlist,
  fromRepo,
  isCommentLine,
  isProductSource,
  lineHits,
  messageTexts,
  packageSourceDirs,
  sourceFiles,
  SRC,
} from './source';

/**
 * Leer ist „—“ (U+2014), ohne Rahmung, an einer Stelle (Durchsicht 0.2.11, Stufe 1, Auftrag 3): `EMPTY` aus
 * `@kompass/core` (`packages/core/src/format/empty.ts`) für Texte, Attribute und `<option>`, `<Empty />`
 * (`components/empty-value.tsx`, grau, zugänglich „keine Angabe“) im JSX. Bis 0.2.11 standen 78 Striche einzeln
 * in der App, drei Halbgeviertstriche im Webseitenbau, und die Sprachdatei rahmte leere Optionen („– keines –“).
 */
const RAW_EMPTY = /(['"`])[—–]\1|>\s*[—–]\s*<|^\s*[—–]\s*$/;

export const rawEmpty = (line: string): boolean => !isCommentLine(line) && RAW_EMPTY.test(line);

const OWNERS = new Set(['apps/kompass/src/components/empty-value.tsx', 'packages/core/src/format/empty.ts']);

export const ALLOWED: CountedAllowlist = {
  'packages/modules/finance/src/ledger/entries.ts': { count: 2, reason: 'SQL-Platzhalter für eine leere `IN`-Liste, keine Anzeige.' },
  'apps/kompass/src/app/(shell)/admin/audit/audit-filters.tsx': { count: 1, reason: 'Bereichsstrich „von – bis“ zwischen zwei Datumsfeldern (`aria-hidden`), kein Leerwert.' },
};

describe('Heuristik', () => {
  it('trifft den Strich als Wert, im JSX und in der Option', () => {
    for (const hit of ["{c.city || '—'}", "x ?? '–'", '<option value="">—</option>', '                    —', "return '—';", 'const a = `—`;'])
      expect(rawEmpty(hit), hit).toBe(true);
  });
  it('trifft keinen Strich im Satz, keinen Kommentar, nicht EMPTY', () => {
    for (const miss of ["t('x') — y", '// leer → „—“', '{c.city || <Empty />}', "x ?? EMPTY", "`${a} – ${b}`", "'— Alle —'"])
      expect(rawEmpty(miss), miss).toBe(false);
  });
});

describe('Leerwert nur über EMPTY und <Empty />', () => {
  // App und Fachmodule; Kern und übrige Pakete liegen außerhalb dieses Wächters.
  const files = [SRC, ...packageSourceDirs().filter((dir) => fromRepo(dir).startsWith('packages/modules/'))].flatMap((dir) => sourceFiles(dir)).filter((file) => isProductSource(file) && !OWNERS.has(fromRepo(file)));
  const hits = lineHits(files, rawEmpty, fromRepo);

  it('kein eigener Strich; Ausnahmen mit Grund', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => checkCountedAllowlist(hits, ALLOWED).stale);

  it('die Sprachdatei rahmt nichts mit Strichen und kennt keinen Strich als Wert', () => {
    const found = messageTexts().filter(([, text]) => /^[—–]/.test(text.trim()) && /[—–]$/.test(text.trim()));
    expect(found.map(([key, text]) => `${key}: ${text}`)).toEqual([]);
  });
});

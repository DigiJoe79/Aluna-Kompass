import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import messages from '../../messages/de.json';
import { checkCountedAllowlist, type CountedAllowlist, isCommentLine, read, sourceFiles, SRC } from './source';

/**
 * Leer ist „—“ (U+2014), ohne Rahmung, an einer Stelle (Durchsicht 0.2.11, Stufe 1, Auftrag 3): `EMPTY` aus
 * `@kompass/core` (`packages/core/src/format/empty.ts`) für Texte, Attribute und `<option>`, `<Empty />`
 * (`components/empty-value.tsx`, grau, zugänglich „keine Angabe“) im JSX. Bis 0.2.11 standen 78 Striche einzeln
 * in der App, drei Halbgeviertstriche im Webseitenbau, und die Sprachdatei rahmte leere Optionen („– keines –“).
 */
const RAW_EMPTY = /(['"`])[—–]\1|>\s*[—–]\s*<|^\s*[—–]\s*$/;

export const rawEmpty = (line: string): boolean => !isCommentLine(line) && RAW_EMPTY.test(line);

const OWNERS = new Set(['apps/kompass/src/components/empty-value.tsx', 'packages/core/src/format/empty.ts']);

const ALLOWED: CountedAllowlist = {
  'packages/modules/finance/src/ledger/entries.ts': { count: 2, reason: 'SQL-Platzhalter für eine leere `IN`-Liste, keine Anzeige.' },
  'apps/kompass/src/app/(shell)/admin/audit/audit-filters.tsx': { count: 1, reason: 'Bereichsstrich „von – bis“ zwischen zwei Datumsfeldern (`aria-hidden`), kein Leerwert.' },
};

const ROOT = path.resolve(SRC, '../../..');
const fromRoot = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const MODULES = path.join(ROOT, 'packages/modules');
const scanDirs = () => [SRC, ...readdirSync(MODULES).map((m) => path.join(MODULES, m, 'src')).filter((dir) => existsSync(dir))];

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
  const hits = scanDirs()
    .flatMap((dir) => sourceFiles(dir))
    .filter((file) => !/\.test\.tsx?$/.test(file) && !file.includes('__e2e') && !OWNERS.has(fromRoot(file)))
    .flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, index) => (rawEmpty(line) ? [{ where: `${fromRoot(file)}:${index + 1}`, file: fromRoot(file) }] : [])),
    );

  it('kein eigener Strich; Ausnahmen mit Grund', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).unexpected).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).stale).toEqual([]);
  });

  it('die Sprachdatei rahmt nichts mit Strichen und kennt keinen Strich als Wert', () => {
    const found: string[] = [];
    const walk = (node: unknown, at: string) => {
      if (typeof node === 'string') {
        const s = node.trim();
        if (/^[—–]/.test(s) && /[—–]$/.test(s)) found.push(`${at}: ${node}`);
      } else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, at ? `${at}.${k}` : k);
    };
    walk(messages, '');
    expect(found).toEqual([]);
  });
});

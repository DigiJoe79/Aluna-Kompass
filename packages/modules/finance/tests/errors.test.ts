import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FINANCE_ERRORS, financeConflict } from '../src/errors';

const SRC = path.resolve(import.meta.dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });

describe('finance errors', () => {
  it('every error names the parameters its text needs, each with its kind (A6: the text is in the language file)', () => {
    for (const [code, params] of Object.entries(FINANCE_ERRORS)) for (const kind of Object.values(params)) expect(['text', 'date', 'cents', 'count', 'evidenceKind', 'runStatus'], code).toContain(kind);
  });

  it('nimmt einen Betrag nur als Zahl in Cent, Datum und Text nur als Text (Befund 4, 0.2.12)', () => {
    // @ts-expect-error — ein Betrag als Text käme roh („1250“) in den Satz.
    financeConflict('cashWouldGoNegative', { account: 'K1', date: '2026-03-04', amount: '1250' });
    // @ts-expect-error — ein Datum ist ein ISO-Tag als Text.
    financeConflict('entryDateInFuture', { date: 20260304, today: '2026-03-01' });
    expect(financeConflict('notReviewed', { count: 2 })).toMatchObject({ error: { params: { count: 2 } } });
  });

  it('carries code, language key and raw parameters — dates as YYYY-MM-DD, amounts in cents, named in `amounts`', () => {
    expect(financeConflict('cashWouldGoNegative', { account: 'K1', date: '2026-03-04', amount: -1250 })).toEqual({
      ok: false,
      error: { type: 'conflict', code: 'cashWouldGoNegative', message: 'cashWouldGoNegative', messageKey: 'finance.errors.cashWouldGoNegative', params: { account: 'K1', date: '2026-03-04', amount: -1250 }, amounts: ['amount'] },
    });
    expect(financeConflict('humanOnly')).toMatchObject({ error: { messageKey: 'finance.errors.humanOnly', params: {} } });
  });

  it('kein Konflikt trägt einen deutschen Satz aus dem Modulcode als Parameter (Befund 49)', () => {
    // Ein Parameter ist ein Wert (Nummer, Name, Datum, Betrag), nie ein Satzstück: Grund und Wortlaut stehen in der
    // Sprachdatei, je Fall ein eigener Code. Gesucht wird ein Wortlaut mit Leerzeichen oder Umlaut als Parameterwert.
    const german = /(['`])[^'`\n]*(?:[äöüÄÖÜß]|[A-Za-z]{2,} [a-zäöüß]{2,})[^'`\n]*\1/;
    const offenders: string[] = [];
    for (const file of files(SRC).filter((f) => f.endsWith('.ts') && !f.includes(`${path.sep}templates${path.sep}`))) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const call of code.matchAll(/financeConflict\('\w+',\s*\{[^}]*\}/g)) if (german.test(call[0])) offenders.push(`${path.relative(SRC, file)}: ${call[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('is the only way the module raises a conflict', () => {
    const offenders = files(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith(`${path.sep}errors.ts`)).filter((f) => /\bconflict\(/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});

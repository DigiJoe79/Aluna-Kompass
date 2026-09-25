import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FINANCE_ERRORS, financeConflict } from '../src/errors';

const SRC = path.resolve(import.meta.dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });

describe('finance errors', () => {
  it('every error says why and what to do about it', () => {
    for (const [code, { reason, remedy }] of Object.entries(FINANCE_ERRORS)) {
      expect(reason.length, code).toBeGreaterThan(10);
      expect(remedy.length, code).toBeGreaterThan(10);
    }
  });

  it('fills placeholders and joins reason and remedy', () => {
    expect(financeConflict('cashWouldGoNegative', { account: 'K1', date: '2026-03-04', amount: '-12,50 €' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'cashWouldGoNegative', message: expect.stringMatching(/2026-03-04.*-12,50 €.*\. .+/) } });
  });

  it('knows the errors of the work list, rules and contact ibans (F5)', () => {
    for (const code of ['ruleNeedsCondition', 'ruleCategoryInactive', 'suggestionStale', 'transactionAlreadyBooked', 'entryLineNotBindable', 'foreignNeedsHolder', 'contactIbanTaken', 'voucherSearchNeedsRead', 'batchNothingReviewed']) {
      expect(Object.keys(FINANCE_ERRORS), code).toContain(code);
    }
    expect(financeConflict('ruleCategoryInactive', { name: 'Büromaterial' })).toMatchObject({ error: { code: 'ruleCategoryInactive', message: expect.stringContaining('Büromaterial') } });
    expect(financeConflict('contactIbanTaken', { contact: 'Erika Beispiel' })).toMatchObject({ error: { code: 'contactIbanTaken', message: expect.stringContaining('Erika Beispiel') } });
    expect(FINANCE_ERRORS.suggestionStale.reason).toBe('Der Kontoumsatz ist inzwischen zugeordnet.');
    expect(FINANCE_ERRORS.entryLineNotBindable.reason).toBe('Diese Buchung hat keine passende Zeile auf diesem Konto ohne Kontoumsatz.');
    expect(FINANCE_ERRORS.foreignNeedsHolder.reason).toBe('Sagen Sie, für wen das Geld ist.');
  });

  it('knows the errors of notices and confirmations (F6a)', () => {
    const codes = [
      'noticeVoided', 'noticeSuperseded', 'noticeNotValidAt', 'noNoticeValidAt', 'noticeAfterExemption', 'confirmationLineNotFinal', 'confirmationLineReversed', 'confirmationIncomeNotCertifiable',
      'confirmationContactIncomplete', 'confirmationLineAlreadyConfirmed', 'confirmationAmountNotPositive', 'confirmationEntryUndocumented', 'confirmationInKindDetailsMissing',
      'confirmationInKindMixed', 'confirmationTypeInactive', 'confirmationExpenseWaiversDisabled', 'confirmationPreNoticeNeedsReason', 'confirmationAlreadyVoided', 'confirmationAlreadySent',
      'confirmationSignedAlready', 'signerOverlaps', 'facsimileTooLarge', 'facsimileNotImage', 'entryLockedByConfirmation', 'contactLockedByConfirmation', 'inKindLineOnly',
    ];
    for (const code of codes) expect(Object.keys(FINANCE_ERRORS), code).toContain(code);
    expect(financeConflict('noNoticeValidAt', { date: '2026-03-10' })).toMatchObject({ error: { code: 'noNoticeValidAt', message: expect.stringMatching(/2026-03-10.*Spenden → Bescheide/) } });
    expect(financeConflict('noticeNotValidAt', { date: '2026-03-10' })).toMatchObject({ error: { message: expect.stringContaining('2026-03-10') } });
    expect(financeConflict('confirmationLineAlreadyConfirmed', { number: 'ZWB-2026-0007' })).toMatchObject({ error: { message: expect.stringContaining('ZWB-2026-0007') } });
    expect(financeConflict('entryLockedByConfirmation', { number: 'ZWB-2026-0007' })).toMatchObject({ error: { message: expect.stringContaining('ZWB-2026-0007') } });
    expect(financeConflict('contactLockedByConfirmation', { number: 'ZWB-2026-0007' })).toMatchObject({ error: { message: expect.stringContaining('ZWB-2026-0007') } });
    expect(financeConflict('confirmationIncomeNotCertifiable', { category: 'Zuschüsse' })).toMatchObject({ error: { message: expect.stringContaining('Zuschüsse') } });
  });

  it('names the kinds of notice in everyday words, never in the words of the tax code (F6a)', () => {
    const hits = Object.entries(FINANCE_ERRORS).flatMap(([code, { reason, remedy }]) =>
      [/vorläufige Anerkennung/, /Freistellungsbescheid/, /Anlage zum Körperschaftsteuerbescheid/].filter((p) => p.test(`${reason} ${remedy}`)).map((p) => `${code}: ${p.source}`),
    );
    expect(hits).toEqual([]);
  });

  it('is the only way the module raises a conflict', () => {
    const offenders = files(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith(`${path.sep}errors.ts`)).filter((f) => /\bconflict\(/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  /**
   * Grund und Abhilfe landen wörtlich in der Oberfläche (F3b Task 7,
   * Spec 2026-09-20 § 10.5 „Modell → Oberfläche“). Dieselbe Verbotsliste wie
   * `apps/kompass/tests/finance-wording.test.ts`, hier gegen `FINANCE_ERRORS`
   * statt `de.json`.
   */
  it('speaks the surface language: none of the model words appears in reason or remedy', () => {
    const FORBIDDEN: { pattern: RegExp; word: string }[] = [
      { pattern: /\bSoll\b/, word: 'Soll' },
      { pattern: /\bHaben\b/, word: 'Haben' },
      { pattern: /\bStorno\w*/, word: 'Storno' },
      { pattern: /\bstornier\w*/, word: 'stornier' },
      { pattern: /\bPeriode\w*/, word: 'Periode' },
      { pattern: /\bGeldkonto\w*/, word: 'Geldkonto' },
      { pattern: /\bGeldzeile\w*/, word: 'Geldzeile' },
      { pattern: /\bZuordnungszeile\w*/, word: 'Zuordnungszeile' },
      { pattern: /\bRohumsatz\w*/, word: 'Rohumsatz' },
      { pattern: /\bImportlauf\w*/, word: 'Importlauf' },
      { pattern: /\bSphäre\w*/, word: 'Sphäre' },
      { pattern: /\bSteuerkennzeichen\w*/, word: 'Steuerkennzeichen' },
      { pattern: /[Oo]ffener?\s+Posten/, word: 'offener/offene Posten' },
      { pattern: /\bDurchlaufposten\w*/, word: 'Durchlaufposten' },
      { pattern: /\bRücklastschrift\w*/, word: 'Rücklastschrift' },
      { pattern: /\bPartnerzahlung\w*/, word: 'Partnerzahlung' },
      { pattern: /\bEmpfängerprofil\w*/, word: 'Empfängerprofil' },
      { pattern: /\bDatierte Werte\b/, word: 'Datierte Werte' },
      { pattern: /\bDoppel\b/, word: 'Doppel' },
      { pattern: /\btransit\b/, word: 'transit' },
    ];

    const hits: string[] = [];
    for (const [code, { reason, remedy }] of Object.entries(FINANCE_ERRORS)) {
      for (const field of ['reason', 'remedy'] as const) {
        const text = field === 'reason' ? reason : remedy;
        for (const { pattern, word } of FORBIDDEN) {
          if (pattern.test(text)) hits.push(`${code}.${field}: Modellwort „${word}“ in "${text}"`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

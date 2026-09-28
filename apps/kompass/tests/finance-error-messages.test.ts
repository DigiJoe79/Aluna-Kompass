import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Failure } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { toCallToolResult } from '@kompass/mcp';
import { FINANCE_ERRORS, financeConflict, type FinanceErrorCode } from '@kompass/module-finance';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { toActionState } from '@/lib/actions';
import { mcpErrorTranslator } from '@/lib/mcp-errors';
import messages from '../messages/de.json';

/**
 * A6 (Architektur-Review): Grund und Abhilfe der Finanzfehler stehen in der Sprachdatei, nicht im Code
 * (Finanz-Spec 5.4). Oberfläche und MCP setzen daraus denselben Text zusammen; Datum und Betrag werden dort
 * formatiert, an einer Stelle (ICU), nicht im Dienst.
 */
const FINANCE_SRC = path.resolve(import.meta.dirname, '../../../packages/modules/finance/src');
const texts = (messages as unknown as { finance: { errors: Record<string, { reason: string; remedy: string }> } }).finance.errors;
const t = createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) as unknown as (key: string, values?: Record<string, unknown>) => string;
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });

const uiText = (failure: Failure) => {
  const state = toActionState(failure, t);
  return state.status === 'error' ? state.message : null;
};
const mcpText = (failure: Failure) => {
  const res = toCallToolResult(failure, mcpErrorTranslator(createTestDeps()));
  return (JSON.parse((res.content[0] as { text: string }).text) as { error: { message: string } }).error.message;
};

describe('Finanzfehler aus der Sprachdatei (A6)', () => {
  it('jeder Code hat Grund und Abhilfe in de.json, und de.json kennt keinen anderen', () => {
    const codes = Object.keys(FINANCE_ERRORS);
    expect(codes.length).toBeGreaterThan(180);
    for (const code of codes) {
      expect(texts[code]?.reason, code).toMatch(/\S{3,}/);
      expect(texts[code]?.remedy, code).toMatch(/\S{3,}/);
    }
    expect(Object.keys(texts).sort()).toEqual([...codes].sort());
  });

  it('in errors.ts steht kein deutscher Satz mehr — nur Codes und Parameterarten', () => {
    const code = readFileSync(path.join(FINANCE_SRC, 'errors.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/[äöüÄÖÜß„“]/);
    const literals = [...code.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]!);
    expect(literals.filter((l) => / \S+ /.test(l))).toEqual([]);
    for (const [c, params] of Object.entries(FINANCE_ERRORS)) for (const kind of Object.values(params)) expect(['text', 'date', 'cents', 'evidenceKind'], c).toContain(kind);
  });

  it('die Platzhalter in de.json sind genau die Parameter des Codes, Datum und Betrag als ICU-Format', () => {
    const wrong: string[] = [];
    for (const [code, params] of Object.entries(FINANCE_ERRORS) as [FinanceErrorCode, Record<string, string>][]) {
      // Ein ICU-`select` (Nachweisart, P) zählt als ein Platzhalter; seine Zweige sind Text.
      const text = `${texts[code]!.reason} ${texts[code]!.remedy}`.replace(/\{(\w+), select,(?:[^{}]|\{[^{}]*\})*\}/g, '{$1, select}');
      const used = new Map([...text.matchAll(/\{(\w+)(?:, ([^}]*))?\}/g)].map((m) => [m[1]!, m[2] ?? ''] as const));
      if ([...used.keys()].sort().join() !== Object.keys(params).sort().join()) wrong.push(`${code}: ${[...used.keys()]} ≠ ${Object.keys(params)}`);
      for (const [name, kind] of Object.entries(params)) {
        const format = used.get(name);
        const expected = kind === 'date' ? 'date, ::ddMMyyyy' : kind === 'cents' ? 'number, ::currency/EUR scale/0.01' : kind === 'evidenceKind' ? 'select' : '';
        if (format !== undefined && format !== expected) wrong.push(`${code}.${name}: „${format}“ statt „${expected}“`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('Oberfläche und MCP zeigen für denselben Konflikt denselben Text', () => {
    for (const failure of [
      financeConflict('humanOnly'),
      financeConflict('cashWouldGoNegative', { account: 'Barkasse', date: '2026-03-04', amount: -1250 }),
      financeConflict('entryLockedByPartnerPayment', { payment: 'PZ-2026-007' }),
    ]) {
      const ui = uiText(failure);
      expect(ui).toBeTruthy();
      expect(mcpText(failure)).toBe(ui);
    }
    expect(uiText(financeConflict('humanOnly'))).toBe(`${texts.humanOnly!.reason} ${texts.humanOnly!.remedy}`);
    // Befund 13 (Spec 10.2): Grund und Abhilfe statt des rohen Einstellungsschlüssels.
    expect(mcpText(financeConflict('humanOnly'))).toMatch(/ein Mensch.*Finanzen einrichten.*Darf ein Agent festschreiben\?/);
  });

  it('Datum und Betrag werden beim Übersetzen formatiert (Befund 38), Wortlaut sonst unverändert', () => {
    expect(uiText(financeConflict('cashWouldGoNegative', { account: 'K1', date: '2026-03-04', amount: -1250 }))).toBe(
      'Das Barkonto K1 wäre am 04.03.2026 mit -12,50\u00a0€ im Minus. Prüfen Sie Datum und Betrag, oder buchen Sie zuerst die fehlende Einnahme oder Abhebung.',
    );
    expect(uiText(financeConflict('entryUnbalanced', { rest: 123456, money: 150000, allocated: 26544 }))).toContain('Es sind noch 1.234,56\u00a0€ zu verteilen: Die Konten ergeben 1.500,00\u00a0€, die Zuordnungen 265,44\u00a0€.');
    expect(uiText(financeConflict('noNoticeValidAt', { date: '2026-03-10' }))).toMatch(/10\.03\.2026.*Spenden → Bescheide/);
    expect(uiText(financeConflict('confirmationBeforeExemptionStart', { entryDate: '2025-03-01', exemptFrom: '2025-04-01' }))).toMatch(/01\.03\.2025.*01\.04\.2025.*Bescheide/);
    // Zwischen Betrag und „€“ steht ein geschütztes Leerzeichen (Intl) — der Betrag bricht nicht um.
    // Ein Datum bleibt derselbe Kalendertag, auch wenn der Verein weit westlich sitzt.
    const west = createTranslator({ locale: 'de', messages, timeZone: 'America/Los_Angeles' }) as unknown as typeof t;
    expect(toActionState(financeConflict('noNoticeValidAt', { date: '2026-03-10' }), west)).toMatchObject({ message: expect.stringContaining('10.03.2026') });
  });

  it('kein Dienst formatiert Betrag oder Datum selbst für eine Meldung', () => {
    const offenders: string[] = [];
    for (const file of files(FINANCE_SRC).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(file, 'utf8');
      for (const call of source.matchAll(/financeConflict\([^;]*?\)\s*[;,)]/g)) if (/formatEuro|germanDate|toLocale/.test(call[0])) offenders.push(`${path.relative(FINANCE_SRC, file)}: ${call[0].slice(0, 80)}`);
    }
    expect(offenders).toEqual([]);
  });

  // Aus `packages/modules/finance/tests/errors.test.ts` übernommen: Wortlaut und Platzhalter, jetzt gegen die Sprachdatei.
  it('füllt die Platzhalter der einzelnen Bereiche', () => {
    const text = (failure: Failure) => uiText(failure) ?? '';
    expect(text(financeConflict('ruleCategoryInactive', { name: 'Büromaterial' }))).toContain('Büromaterial');
    expect(text(financeConflict('contactIbanTaken', { contact: 'Erika Beispiel' }))).toContain('Erika Beispiel');
    expect(texts.suggestionStale!.reason).toBe('Der Kontoumsatz ist inzwischen zugeordnet.');
    expect(texts.entryLineNotBindable!.reason).toBe('Diese Buchung hat keine passende Zeile auf diesem Konto ohne Kontoumsatz.');
    expect(texts.foreignNeedsHolder!.reason).toBe('Sagen Sie, für wen das Geld ist.');
    expect(text(financeConflict('noticeNotValidAt', { date: '2026-03-10' }))).toContain('10.03.2026');
    for (const code of ['confirmationLineAlreadyConfirmed', 'entryLockedByConfirmation', 'contactLockedByConfirmation'] as const) expect(text(financeConflict(code, { number: 'ZWB-2026-0007' })), code).toContain('ZWB-2026-0007');
    expect(text(financeConflict('confirmationIncomeNotCertifiable', { category: 'Zuschüsse' }))).toContain('Zuschüsse');
    expect(text(financeConflict('runBlockedNoNotice'))).toContain('Am Ausstellungstag gilt kein Bescheid des Finanzamts.');
    expect(text(financeConflict('statementUnreadableAtLine', { line: '2' }))).toContain('Der Auszug lässt sich nicht lesen (Zeile 2).');
    expect(texts.bundleToolsMissing!.remedy).toContain('pdfunite');
    expect(text(financeConflict('expenseNeedsContactLink', { names: 'Jonas Feld, Erika Beispiel' }))).toContain('Jonas Feld, Erika Beispiel');
    expect(text(financeConflict('expensePositionNeedsReceipt', { position: 2 }))).toContain('Position 2');
    expect(text(financeConflict('expenseCategoryRequired', { position: 3 }))).toContain('Position 3');
    expect(text(financeConflict('waiverFundsInsufficient', { free: 12000, amount: 25000, date: '2026-03-05' }))).toMatch(/05\.03\.2026.*120,00\s€.*250,00\s€/);
    expect(text(financeConflict('expenseFileTooLarge', { file: 'a.pdf', limit: '5 MB' }))).toContain('5 MB');
    // „Ihre Eingaben bleiben stehen“ (Annahme 5): Eine abgelehnte Datei kostet nichts von dem, was schon getippt ist.
    for (const code of ['expenseFileNotPdf', 'expenseFileTooLarge'] as const) expect(texts[code]!.remedy, code).toContain('Ihre Eingaben bleiben stehen');
    expect(texts.expenseWaiversDisabled!.remedy).toContain('ohne Verzicht neu ein');
    for (const code of ['expenseOwnClaim', 'expenseSameContact'] as const) expect(text(financeConflict(code, { names: 'Vera Verwalterin' })), code).toContain('Das kann erledigen: Vera Verwalterin');
    expect(text(financeConflict('evidenceExplanationMissing', { kind: 'report' }))).toContain('Bericht');
    expect(texts.partnerBasisNotForAgent!.reason).toContain('in unserem Auftrag');
    expect(texts.partnerBasisNeedsOrganization!.reason).toContain('Organisation');
    expect(text(financeConflict('reserveInsufficient', { date: '2026-03-05', name: 'Freie Rücklage', available: 5000, amount: 8000 }))).toMatch(/05\.03\.2026.*50,00\s€.*80,00\s€/);
    expect(text(financeConflict('resolutionTypeInactive', { names: 'Vera Verwalterin' }))).toContain('Vera Verwalterin');
  });

  it('nennt die Arten der Bescheide in Alltagsworten, nie in denen der Abgabenordnung (F6a)', () => {
    const hits = Object.entries(texts).flatMap(([code, { reason, remedy }]) =>
      [/vorläufige Anerkennung/, /Freistellungsbescheid/, /Anlage zum Körperschaftsteuerbescheid/].filter((p) => p.test(`${reason} ${remedy}`)).map((p) => `${code}: ${p.source}`),
    );
    expect(hits).toEqual([]);
  });

  it('zeigt jeden Datumsparameter als deutsches Datum und lässt andere Parameter, wie sie sind (Befund 38)', () => {
    const dated = Object.entries(FINANCE_ERRORS).filter(([, params]) => Object.values(params).includes('date')) as [FinanceErrorCode, Record<string, string>][];
    expect(dated.map(([code]) => code)).toEqual(expect.arrayContaining(['entryDateInFuture', 'noFiscalYearForDate', 'movementDateInFuture', 'confirmationBeforeExemptionStart']));
    for (const [code, params] of dated) {
      const values = Object.fromEntries(Object.entries(params).map(([name, kind]) => [name, kind === 'date' ? '2026-09-26' : kind === 'cents' ? 100 : 'x']));
      const message = uiText((financeConflict as (c: string, p: object) => Failure)(code, values)) ?? '';
      expect(message, code).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(message, code).toContain('26.09.2026');
    }
    expect(uiText(financeConflict('cashWouldGoNegative', { account: 'Kasse 2026-09', date: '2026-09-26', amount: 1200 }))).toContain('Das Barkonto Kasse 2026-09 wäre am 26.09.2026 mit 12,00 € im Minus.');
    expect(uiText(financeConflict('draftsInPeriod', { count: 2026 }))).toContain('noch 2026 Entwürfe');
  });
});


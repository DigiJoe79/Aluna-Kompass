import { unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { recordReserveMovement, saveReserve } from '../src/allocation/reserves';
import { confirmClosingStep } from '../src/closing/confirmations';
import { getClosingStatus } from '../src/closing/status';
import { CLOSING_STEPS, type ClosingStatus, type ClosingStepKey } from '../src/closing/types';
import { createAccount, setAccountActive } from '../src/ledger/accounts';
import { countCash } from '../src/ledger/cash';
import { bookEntry } from '../src/ledger/finalize';
import { deleteDraft, saveDraft } from '../src/ledger/entries';
import { createOpenItem } from '../src/ledger/open-items';
import { closeInternal, justifyUndocumentedEntry, reopenInternal } from '../src/ledger/period';
import { confirmAccountForYear, fileAccountStatementDocument } from '../src/ledger/statement-documents';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { financeAccounts, financeFiscalYears } from '../src/schema';
import { allowHumanOnlyOverMcp, insertDocument, insertRun, ledgerFixture, pdfBytes } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));
const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));

async function setup() {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const y2025 = f.years['2025']!.id;
  const y2026 = f.years['2026']!.id;
  const book = async (date: string, cents: number, opts: { accountId?: string; categoryId?: string; purposeId?: string; contactId?: string; reason?: string } = {}) =>
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Buchung', moneyLines: [{ accountId: opts.accountId ?? f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: opts.categoryId ?? f.donations.id, amountCents: cents, ...(opts.purposeId ? { purposeId: opts.purposeId } : {}), ...(opts.contactId ? { contactId: opts.contactId } : {}) }], ...(opts.reason ? { reason: opts.reason } : {}) }));
  const status = async (yearId = y2025) => unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: yearId }));
  const step = (s: ClosingStatus, key: ClosingStepKey) => s.steps.find((x) => x.key === key)!;
  const confirm = (step: string, note?: string) => confirmClosingStep(f.deps, f.ctx, { fiscalYearId: y2025, step, ...(note ? { note } : {}) });
  const noCash = async () => unwrap(await setAccountActive(f.deps, f.ctx, { id: f.cash.id, isActive: false, expectedVersion: f.deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, f.cash.id)).get()!.updatedAt }));
  const yearRow = (id = y2025) => f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, id)).get()!;
  return { f, y2025, y2026, book, status, step, confirm, noCash, yearRow };
}

describe('Jahresabschluss — Stand der Schritte 1 bis 8', () => {
  it('numbers and groups the twelve steps and points at the first open one', async () => {
    const t = await setup();
    const s = await t.status();
    expect(s.steps.map((x) => x.key)).toEqual([...CLOSING_STEPS]);
    expect(s.steps.map((x) => x.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(s.steps.map((x) => x.group)).toEqual(['before', 'before', 'before', 'before', 'before', 'before', 'before', 'close', 'after', 'after', 'after', 'after']);
    expect(s).toMatchObject({ fiscalYearId: t.y2025, designation: '2025', ended: true, yearStatus: 'open', reopened: null, toRepeat: [], handovers: [], me: { canConfirm: true, canClose: true, canHandover: true, canCount: true, canRunConfirmations: true } });
    expect(s.next).toBe('statements');
    expect(s.doneCount).toBe(s.steps.filter((x) => x.done).length);
    expect(unwrap(await getClosingStatus(t.f.deps, ctxWith(['finance.read'], t.f.userId), { fiscalYearId: t.y2025 })).me).toEqual({ canConfirm: false, canClose: false, canHandover: false, canCount: false, canRunConfirmations: false });
    expect(code(await getClosingStatus(t.f.deps, ctxWith(['finance.overview'], t.f.userId), { fiscalYearId: t.y2025 }))).toBe('forbidden');
  });

  it('needs every statement imported and booked and the confirmation for step 1 — a missing pdf does not block it', async () => {
    const t = await setup();
    await t.book('2025-03-01', 1000);
    let s1 = t.step(await t.status(), 'statements');
    expect(s1).toMatchObject({ done: false, confirmable: true, facts: { key: 'statements', accountsWithoutImport: 1, openTransactions: 0 } });
    expect(s1.facts.key === 'statements' && s1.facts.accounts.map((a) => a.name)).toEqual(['Vereinskonto']);
    unwrap(await t.confirm('statements'));
    expect(t.step(await t.status(), 'statements').done).toBe(false);
    insertRun(t.f, t.f.bank.id, { periodFrom: '2025-01-01', periodTo: '2025-12-31' });
    s1 = t.step(await t.status(), 'statements');
    expect(s1).toMatchObject({ done: true, confirmation: { note: null, byUserId: t.f.userId } });
    expect(s1.facts.key === 'statements' && s1.facts.accounts[0]!.needsPdf).toBe(true);
  });

  it('marks the cash step done without a cash account', async () => {
    const t = await setup();
    expect(t.step(await t.status(), 'cash')).toMatchObject({ done: false, confirmable: false });
    await t.noCash();
    expect(t.step(await t.status(), 'cash')).toMatchObject({ done: true, facts: { key: 'cash', accounts: [] } });
  });

  it('needs a count at year end for each active cash account', async () => {
    const t = await setup();
    const count = (countedOn: string) => countCash(t.f.deps, t.f.ctx, { accountId: t.f.cash.id, countedOn, countedCents: 0, counterOneContactId: t.f.donor.id, counterTwoContactId: t.f.wrongDonor.id }).then(unwrap);
    await count('2025-12-30');
    expect(t.step(await t.status(), 'cash').done).toBe(false);
    const jan2 = await count('2026-01-02');
    const cash = t.step(await t.status(), 'cash');
    expect(cash).toMatchObject({ done: true, facts: { key: 'cash', accounts: [{ accountId: t.f.cash.id, name: 'Barkasse', count: { countId: jan2.count.id, countedOn: '2026-01-02', countedCents: 0, differenceCents: 0 } }] } });
    await t.book('2026-01-03', 500, { accountId: t.f.cash.id });
    await t.book('2026-01-01', 200, { accountId: t.f.cash.id });
    expect(t.step(await t.status(), 'cash').done).toBe(false);
    await count('2025-12-31');
    expect(t.step(await t.status(), 'cash').done).toBe(true);
  });

  describe('cash counted only after year end (Befund 1)', () => {
    const counter = (t: Awaited<ReturnType<typeof setup>>) => (accountId: string, countedOn: string, countedCents: number) =>
      countCash(t.f.deps, t.f.ctx, { accountId, countedOn, countedCents, counterOneContactId: t.f.donor.id, counterTwoContactId: t.f.wrongDonor.id }).then(unwrap);

    it('a count at year end is done and needs no confirmation', async () => {
      const t = await setup();
      await t.book('2025-06-01', 1000, { accountId: t.f.cash.id });
      await counter(t)(t.f.cash.id, '2025-12-31', 1000);
      const cash = t.step(await t.status(), 'cash');
      expect(cash).toMatchObject({ done: true, confirmable: false, facts: { key: 'cash', accounts: [{ count: { countedOn: '2025-12-31' }, later: null }] } });
    });

    it('a later count without bookings in between counts like one at year end', async () => {
      const t = await setup();
      await t.book('2025-06-01', 1000, { accountId: t.f.cash.id });
      await counter(t)(t.f.cash.id, '2026-01-05', 1000);
      const cash = t.step(await t.status(), 'cash');
      expect(cash).toMatchObject({ done: true, confirmable: false, facts: { key: 'cash', accounts: [{ count: { countedOn: '2026-01-05' }, later: null }] } });
    });

    const recompute = (t: Awaited<ReturnType<typeof setup>>, accountId: string, note: string | null = 'Am 31.12. war niemand im Büro.', ctx = t.f.ctx) =>
      confirmAccountForYear(t.f.deps, ctx, { fiscalYearId: t.y2025, accountId, kind: 'cashRecomputed', note });

    it('a later count without difference after bookings is confirmed per box, reckoned back to the book balance at year end', async () => {
      const t = await setup();
      await t.book('2025-06-01', 1000, { accountId: t.f.cash.id });
      await t.book('2026-01-02', 200, { accountId: t.f.cash.id });
      const later = await counter(t)(t.f.cash.id, '2026-01-05', 1200);
      const cash = t.step(await t.status(), 'cash');
      expect(cash).toMatchObject({
        done: false,
        confirmable: false,
        facts: { key: 'cash', accounts: [{ count: null, confirmation: null, later: { countId: later.count.id, countedOn: '2026-01-05', countedCents: 1200, differenceCents: 0, bookCentsAtEnd: 1000 } }] },
      });
      // Den Schritt als Ganzes bestätigt man nicht mehr (Board 14a), nur die Kasse.
      expect(fields(await t.confirm('cash', 'Rückgerechnet.'))).toEqual(['step:notConfirmable']);
      expect(fields(await recompute(t, t.f.cash.id, null))).toEqual(['note:required']);
      unwrap(await recompute(t, t.f.cash.id));
      expect(JSON.parse(auditEntry(t.f.deps, 'finance.account.yearConfirm').params!)).toEqual({ designation: '2025', kind: 'cashRecomputed' });
      expect(t.step(await t.status(), 'cash')).toMatchObject({ done: true, confirmable: false, confirmation: null, facts: { accounts: [{ confirmation: { note: 'Am 31.12. war niemand im Büro.', byUserId: t.f.userId } }] } });
    });

    it('a count at year end never needs a confirmation — recomputing is refused', async () => {
      const t = await setup();
      await t.book('2025-06-01', 1000, { accountId: t.f.cash.id });
      await counter(t)(t.f.cash.id, '2025-12-31', 1000);
      expect(code(await recompute(t, t.f.cash.id))).toBe('cashNotRecomputable');
    });

    it('a later count with a difference is never confirmable', async () => {
      const t = await setup();
      await t.book('2025-06-01', 1000, { accountId: t.f.cash.id });
      await t.book('2026-01-02', 200, { accountId: t.f.cash.id });
      await counter(t)(t.f.cash.id, '2026-01-05', 1300);
      const cash = t.step(await t.status(), 'cash');
      expect(cash).toMatchObject({ done: false, confirmable: false, facts: { key: 'cash', accounts: [{ count: null, later: { differenceCents: 100, bookCentsAtEnd: 1000 } }] } });
      expect(code(await recompute(t, t.f.cash.id))).toBe('cashNotRecomputable');
      expect(t.step(await t.status(), 'cash').done).toBe(false);
    });

    it('without any count there is nothing to recompute', async () => {
      const t = await setup();
      const cash = t.step(await t.status(), 'cash');
      expect(cash).toMatchObject({ done: false, confirmable: false, facts: { key: 'cash', accounts: [{ count: null, later: null, confirmation: null }] } });
      expect(code(await recompute(t, t.f.cash.id))).toBe('cashNotRecomputable');
    });

    it('recomputing is only for a cash box, and needs finance.periodClose', async () => {
      const t = await setup();
      expect(code(await recompute(t, t.f.bank.id))).toBe('accountKindMismatch');
      expect(code(await recompute(t, t.f.cash.id, 'x', ctxWith(['finance.read', 'finance.entriesFinalize'], t.f.userId)))).toBe('forbidden');
    });

    it('two cash boxes: done once every box is counted or confirmed', async () => {
      const t = await setup();
      const second = unwrap(await createAccount(t.f.deps, t.f.ctx, { name: 'Zählkasse', kind: 'cash' }));
      await t.book('2025-06-01', 1000, { accountId: t.f.cash.id });
      await t.book('2026-01-02', 200, { accountId: t.f.cash.id });
      await counter(t)(t.f.cash.id, '2026-01-05', 1200);
      expect(t.step(await t.status(), 'cash')).toMatchObject({ done: false, confirmable: false });
      unwrap(await recompute(t, t.f.cash.id));
      expect(t.step(await t.status(), 'cash').done).toBe(false);
      await counter(t)(second.id, '2025-12-31', 0);
      expect(t.step(await t.status(), 'cash').done).toBe(true);
    });

    it('over MCP the same rules apply', async () => {
      const t = await setup();
      await t.book('2025-06-01', 1000, { accountId: t.f.cash.id });
      await t.book('2026-01-02', 200, { accountId: t.f.cash.id });
      await counter(t)(t.f.cash.id, '2026-01-05', 1300);
      const tool = FINANCE_MCP_TOOLS.find((x) => x.name === 'finance_account_year_confirm')!;
      const mcp = { ...t.f.ctx, channel: 'mcp' as const, apiTokenId: 'TOKEN' };
      const call = (accountId: string) => tool.handler(t.f.deps, mcp, (tool.inputSchema as z.ZodType).parse({ fiscalYearId: t.y2025, accountId, kind: 'cashRecomputed', note: 'Grund' }));
      expect(code(await call(t.f.cash.id))).toBe('humanOnly');
      allowHumanOnlyOverMcp(t.f.deps);
      expect(code(await call(t.f.cash.id))).toBe('cashNotRecomputable');
      expect(code(await call(t.f.bank.id))).toBe('accountKindMismatch');
    });
  });

  it('lets the lists step be confirmed only for vouchers without entry and foreign money', async () => {
    const t = await setup();
    await t.noCash();
    expect(t.step(await t.status(), 'lists')).toMatchObject({ done: true, confirmable: false, facts: { key: 'lists', undocumentedUnjustified: 0, drafts: 0, vouchersWithoutEntry: 0, foreignMoneyOpen: 0 } });
    expect(code(await t.confirm('lists', 'alles gut'))).toBe('closingStepNotConfirmable');
    const draft = unwrap(await saveDraft(t.f.deps, t.f.ctx, { entryDate: '2025-05-01', text: 'Entwurf', moneyLines: [{ accountId: t.f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: t.f.donations.id, amountCents: 100 }] }));
    const loose = insertDocument(t.f, { subject: 'Rechnung ohne Buchung' });
    t.f.deps.sqlite.prepare("update documents set document_date = '2025-06-01' where id = ?").run(loose);
    expect(t.step(await t.status(), 'lists')).toMatchObject({ done: false, confirmable: false, facts: { drafts: 1, vouchersWithoutEntry: 1 } });
    expect(code(await t.confirm('lists', 'Beleg gehört ins Folgejahr'))).toBe('closingStepNotConfirmable');
    unwrap(await deleteDraft(t.f.deps, t.f.ctx, { id: draft.id }));
    // Ein Kontoauszug am Konto ist kein Beleg ohne Buchung.
    unwrap(await fileAccountStatementDocument(t.f.deps, t.f.ctx, { accountId: t.f.bank.id, periodTo: '2025-12-31', bytes: pdfBytes() }));
    expect(t.step(await t.status(), 'lists')).toMatchObject({ done: false, confirmable: true, facts: { drafts: 0, vouchersWithoutEntry: 1 } });
    expect(fields(await t.confirm('lists'))).toEqual(['note:required']);
    unwrap(await t.confirm('lists', 'Beleg gehört ins Folgejahr'));
    expect(t.step(await t.status(), 'lists')).toMatchObject({ done: true, confirmation: { note: 'Beleg gehört ins Folgejahr' } });
    const missing = await t.book('2025-07-01', -300, { categoryId: t.f.programCosts.id });
    expect(t.step(await t.status(), 'lists')).toMatchObject({ done: false, facts: { undocumentedUnjustified: 1 } });
    unwrap(await justifyUndocumentedEntry(t.f.deps, t.f.ctx, { entryId: missing.id, note: 'Quittung verloren' }));
    expect(t.step(await t.status(), 'lists').done).toBe(true);
    // Begründet ohne Beleg zählt mit — dieselbe Zahl wie die Belegprüfung (Designer Runde 7, 295/266).
    const { runFinanceReport } = await import('../src/reporting/service');
    const check = unwrap(await runFinanceReport(t.f.deps, t.f.ctx, { report: 'voucherCheck', params: { fiscalYearId: t.y2025 } })).data as { withoutVoucher: unknown[] };
    expect(t.step(await t.status(), 'lists').facts).toMatchObject({ undocumentedUnjustified: 0, undocumentedJustified: check.withoutVoucher.length });
    expect(check.withoutVoucher.length).toBeGreaterThan(0);
  });

  it('counts open items at year end; the step is done without any or with a confirmation', async () => {
    const t = await setup();
    expect(t.step(await t.status(), 'openItems')).toMatchObject({ done: true, confirmable: true, facts: { key: 'openItems', receivables: { count: 0, cents: 0 }, payables: { count: 0, cents: 0 } } });
    unwrap(await createOpenItem(t.f.deps, t.f.ctx, { kind: 'receivable', itemDate: '2025-11-01', amountCents: 2500 }));
    unwrap(await createOpenItem(t.f.deps, t.f.ctx, { kind: 'payable', itemDate: '2026-01-05', amountCents: 900 }));
    expect(t.step(await t.status(), 'openItems')).toMatchObject({ done: false, facts: { receivables: { count: 1, cents: 2500 }, payables: { count: 0, cents: 0 } } });
    expect(fields(await t.confirm('openItems'))).toEqual(['note:required']);
    unwrap(await t.confirm('openItems', 'Forderung im Januar bezahlt'));
    expect(t.step(await t.status(), 'openItems').done).toBe(true);
  });

  it('purposes: none below zero, and the open ones with money confirmed', async () => {
    const t = await setup();
    expect(t.step(await t.status(), 'purposes')).toMatchObject({ done: true, facts: { key: 'purposes', closedInYear: 0, openWithBalance: 0, restCents: 0, negative: 0 } });
    await t.book('2025-04-01', 3000, { purposeId: t.f.abroadPurpose.id });
    expect(t.step(await t.status(), 'purposes')).toMatchObject({ done: false, facts: { openWithBalance: 1, restCents: 3000, negative: 0 } });
    unwrap(await t.confirm('purposes', 'Restmittel gehen ins Folgejahr'));
    expect(t.step(await t.status(), 'purposes').done).toBe(true);
    await t.book('2025-05-01', -5000, { purposeId: t.f.abroadPurpose.id, categoryId: t.f.programCosts.id, reason: 'Vorschuss aus freien Mitteln' });
    expect(t.step(await t.status(), 'purposes')).toMatchObject({ done: false, facts: { negative: 1 } });
  });

  it('reserves: done without any, otherwise confirmed', async () => {
    const t = await setup();
    expect(t.step(await t.status(), 'reserves')).toMatchObject({ done: true, facts: { key: 'reserves', reserves: [] } });
    const reserve = unwrap(await saveReserve(t.f.deps, t.f.ctx, { kind: 'replacement', name: 'Rücklage Fahrzeug', purposeText: 'Ersatz des Vereinsbusses', resolutionUpload: { bytes: pdfBytes(), fileName: 'beschluss.pdf', documentDate: '2025-01-10' } }));
    expect(t.step(await t.status(), 'reserves').done).toBe(true);
    unwrap(await recordReserveMovement(t.f.deps, t.f.ctx, { reserveId: reserve.id, kind: 'allocate', movementDate: '2025-06-30', amountCents: 10000, resolutionUpload: { bytes: pdfBytes(), fileName: 'zufuehrung.pdf', documentDate: '2025-06-30' } }));
    expect(t.step(await t.status(), 'reserves')).toMatchObject({ done: false, facts: { reserves: [{ reserveId: reserve.id, name: 'Rücklage Fahrzeug', openingCents: 0, closingCents: 10000, hasResolution: true }] } });
    unwrap(await t.confirm('reserves', 'Beschluss liegt ab, keine Zuführung'));
    expect(t.step(await t.status(), 'reserves').done).toBe(true);
  });

  it('confirmations: shows the uncertified and the ones to correct, blocks nothing', async () => {
    const t = await setup();
    expect(t.step(await t.status(), 'confirmations')).toMatchObject({ done: true, facts: { key: 'confirmations', uncertified: 0, toCorrect: 0, toCorrectNumbers: [] } });
    await t.book('2025-03-01', 4000, { contactId: t.f.donor.id });
    expect(t.step(await t.status(), 'confirmations')).toMatchObject({ done: false, facts: { uncertified: 1, toCorrect: 0 } });
    unwrap(await t.confirm('confirmations', 'Spenderin wünscht keine Bestätigung'));
    expect(t.step(await t.status(), 'confirmations').done).toBe(true);
  });

  it('step 8 is done when the year is closed; before that it shows the close preview', async () => {
    const t = await setup();
    const before = t.step(await t.status(), 'close');
    expect(before).toMatchObject({ done: false, confirmable: false, facts: { key: 'close', closedAt: null } });
    expect(before.facts.key === 'close' && before.facts.preview).toMatchObject({ canClose: expect.any(Boolean) });
    t.f.closeYear(t.y2025);
    expect(t.step(await t.status(), 'close')).toMatchObject({ done: true, facts: { closedAt: '2025-12-31T23:59:59.000Z', preview: null } });
    expect((await t.status()).yearStatus).toBe('closed');
  });

  it('confirms only in an ended year, only confirmable steps, with a note except for step 1', async () => {
    const t = await setup();
    expect(code(await confirmClosingStep(t.f.deps, t.f.ctx, { fiscalYearId: t.y2026, step: 'statements' }))).toBe('fiscalYearNotEnded');
    expect(fields(await t.confirm('auditPackage', 'x'))).toEqual(['step:notConfirmable']);
    expect(fields(await t.confirm('close', 'x'))).toEqual(['step:notConfirmable']);
    expect(fields(await t.confirm('reserves', 'x'.repeat(1001)))).toEqual(['note:tooLong']);
    unwrap(await t.confirm('reserves', 'erste'));
    expect(JSON.parse(auditEntry(t.f.deps, 'finance.closing.confirm').params!)).toEqual({ designation: '2025', step: 'reserves' });
    t.f.deps.clock.advance(60_000);
    unwrap(await t.confirm('reserves', 'zweite'));
    expect(t.step(await t.status(), 'reserves').confirmation?.note).toBe('zweite');
    expect(t.f.deps.sqlite.prepare("select count(*) as n from finance_closing_confirmations where step = 'reserves'").get()).toEqual({ n: 2 });
    expect(() => t.f.deps.sqlite.prepare('delete from finance_closing_confirmations').run()).toThrow();
    expect(() => t.f.deps.sqlite.prepare("update finance_closing_confirmations set note = 'x'").run()).toThrow();
    const mcp = { ...t.f.ctx, channel: 'mcp' as const };
    expect(code(await confirmClosingStep(t.f.deps, mcp, { fiscalYearId: t.y2025, step: 'reserves', note: 'x' }))).toBe('humanOnly');
    expect(code(await confirmClosingStep(t.f.deps, ctxWith(['finance.read'], t.f.userId), { fiscalYearId: t.y2025, step: 'reserves', note: 'x' }))).toBe('forbidden');
    allowHumanOnlyOverMcp(t.f.deps);
    expect(code(await confirmClosingStep(t.f.deps, mcp, { fiscalYearId: t.y2025, step: 'reserves', note: 'x' }))).toBe('ok');
  });

  it('shows what to repeat after reopening', async () => {
    const t = await setup();
    unwrap(await t.confirm('reserves', 'vorher bestätigt'));
    t.f.deps.db.transaction((tx) => unwrap(closeInternal(tx, t.f.deps, t.f.ctx, t.yearRow())));
    expect((await t.status()).reopened).toBeNull();
    t.f.deps.clock.advance(60_000);
    t.f.deps.db.transaction((tx) => unwrap(reopenInternal(tx, t.f.deps, t.f.ctx, { id: t.y2025, note: 'Fehlbuchung' })));
    let s = await t.status();
    expect(s.reopened).toMatchObject({ byUserId: t.f.userId, reason: 'Fehlbuchung' });
    expect(s.toRepeat).toEqual(['close', 'auditPackage', 'auditReport']);
    expect(t.step(s, 'reserves').done).toBe(true);
    t.f.deps.clock.advance(60_000);
    t.f.deps.db.transaction((tx) => unwrap(closeInternal(tx, t.f.deps, t.f.ctx, t.yearRow())));
    s = await t.status();
    expect(s.toRepeat).toEqual(['auditPackage', 'auditReport']);
    expect(s.reopened).not.toBeNull();
  });
});

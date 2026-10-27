import { fakeTextExtraction, unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { documentLinks, documents } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount } from '../src/ledger/accounts';
import { bookEntry } from '../src/ledger/finalize';
import { accountStatementsForYearInternal, confirmAccountForYear, fileAccountStatementDocument, linkAccountStatementDocument, missingStatementPdfsInternal, suggestStatementPeriod } from '../src/ledger/statement-documents';
import { allowHumanOnlyOverMcp, insertDocument, insertRun, ledgerFixture, pdfBytes } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));
const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));

async function setup() {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const y2025 = f.years['2025']!.id;
  const second = unwrap(await createAccount(f.deps, f.ctx, { name: 'Zweitbank', kind: 'bank', iban: 'DE48999999990000404040' }));
  const paypal = unwrap(await createAccount(f.deps, f.ctx, { name: 'Bezahldienst', kind: 'paymentService' }));
  const move = (accountId: string, date: string, cents = 1000) => bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Spende', moneyLines: [{ accountId, amountCents: cents }], allocationLines: [{ categoryId: f.donations.id, amountCents: cents }] }).then(unwrap);
  await move(f.bank.id, '2025-06-01');
  await move(second.id, '2025-12-20');
  await move(paypal.id, '2025-05-01');
  await move(f.cash.id, '2025-05-02');
  return { ...f, y2025, second, paypal, move };
}

describe('Kontoauszüge als PDF je Konto', () => {
  it('files a statement pdf for a bank account', async () => {
    const f = await setup();
    const filed = unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, periodFrom: '2025-12-01', periodTo: '2025-12-31', bytes: pdfBytes(), fileName: 'auszug.pdf' }));
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, filed.documentId)).get()!;
    expect(doc.typeKey).toBe('bank-statement');
    const links = f.deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, filed.documentId)).all().map((l) => `${l.entityType}:${l.entityId}`);
    expect(links.sort()).toEqual([`financeAccount:${f.bank.id}`, `financeFiscalYear:${f.y2025}`].sort());
    expect(JSON.parse(auditEntry(f.deps, 'finance.account.statementFile').params!)).toEqual({ designation: '2025', documentNumber: doc.number });
    expect(code(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.cash.id, periodTo: '2025-12-31', bytes: pdfBytes() }))).toBe('statementNotForCash');
    expect(fields(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, periodTo: '2025-12-31', bytes: new TextEncoder().encode('kein pdf') }))).toEqual(['bytes:notPdf']);
    expect(code(await fileAccountStatementDocument(f.deps, ctxWith(['finance.read'], f.userId), { accountId: f.bank.id, periodTo: '2025-12-31', bytes: pdfBytes() }))).toBe('forbidden');
  });

  it('links a statement from the records', async () => {
    const f = await setup();
    const statement = insertDocument(f, { subject: 'Auszug', typeKey: 'bank-statement' });
    const invoice = insertDocument(f, { subject: 'Rechnung' });
    const voided = insertDocument(f, { subject: 'Auszug alt', typeKey: 'bank-statement', voided: true });
    expect(fields(await linkAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, documentId: invoice, periodTo: '2025-12-31' }))).toEqual(['documentId:notABankStatement']);
    expect(fields(await linkAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, documentId: voided, periodTo: '2025-12-31' }))).toEqual(['documentId:notABankStatement']);
    expect(fields(await linkAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, documentId: statement, periodFrom: '2025-12-31', periodTo: '2025-12-01' }))).toEqual(['periodTo:beforePeriodFrom']);
    unwrap(await linkAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, documentId: statement, periodTo: '2025-12-31' }));
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, statement), eq(documentLinks.entityType, 'financeAccount'))).get()?.entityId).toBe(f.bank.id);
    expect(accountStatementsForYearInternal(f.deps.db, f.y2025).find((r) => r.accountId === f.bank.id)?.statement).toMatchObject({ documentId: statement, covers: true });
    expect(JSON.parse(auditEntry(f.deps, 'finance.account.statementLink').params!)).toMatchObject({ designation: '2025' });
  });

  it('lists the accounts of the year', async () => {
    const f = await setup();
    unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, periodTo: '2025-12-31', bytes: pdfBytes() }));
    unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.second.id, periodTo: '2025-11-30', bytes: pdfBytes() }));
    const voided = unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.second.id, periodTo: '2025-12-31', bytes: pdfBytes() }));
    f.deps.db.update(documents).set({ status: 'voided' }).where(eq(documents.id, voided.documentId)).run();
    insertRun(f, f.paypal.id, { closingCents: 1000, periodTo: '2025-12-31' });
    const rows = accountStatementsForYearInternal(f.deps.db, f.y2025);
    expect(rows.map((r) => r.name)).toEqual(['Bezahldienst', 'Vereinskonto', 'Zweitbank']);
    expect(rows.find((r) => r.accountId === f.bank.id)).toMatchObject({ kind: 'bank', needsPdf: false, statement: { covers: true, periodTo: '2025-12-31' }, balanceAtYearEndCents: 1000 });
    expect(rows.find((r) => r.accountId === f.second.id)).toMatchObject({ needsPdf: true, statement: { covers: false, periodTo: '2025-11-30' }, lastStatementTo: '2025-11-30', lastMovementOn: '2025-12-20' });
    expect(rows.find((r) => r.accountId === f.paypal.id)).toMatchObject({ kind: 'paymentService', needsPdf: false, statement: null, importedBalance: { cents: 1000, on: '2025-12-31' } });
    expect(missingStatementPdfsInternal(f.deps.db, f.y2025)).toEqual([{ accountId: f.second.id, name: 'Zweitbank' }]);
  });

  it('takes the balance of the latest import when several end on the same day (Test-Abnahme 2026-10-27)', async () => {
    const f = await setup();
    insertRun(f, f.paypal.id, { closingCents: 18601, periodTo: '2025-12-20', startedAt: '2025-12-20T09:50:00.000Z' });
    insertRun(f, f.paypal.id, { closingCents: 19801, periodTo: '2025-12-20', startedAt: '2025-12-20T10:41:00.000Z' });
    insertRun(f, f.paypal.id, { closingCents: 21001, periodTo: '2025-12-20', startedAt: '2025-12-20T14:03:00.000Z' });
    expect(accountStatementsForYearInternal(f.deps.db, f.y2025).find((r) => r.accountId === f.paypal.id)?.importedBalance).toEqual({ cents: 21001, on: '2025-12-20' });
  });

  it('a bank account without any statement in the year has none and names the last one', async () => {
    const f = await setup();
    unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.second.id, periodTo: '2024-12-31', bytes: pdfBytes() }));
    expect(accountStatementsForYearInternal(f.deps.db, f.y2025).find((r) => r.accountId === f.second.id)).toMatchObject({ statement: null, needsPdf: true, lastStatementTo: '2024-12-31' });
  });

  it('justifies a missing statement and confirms a payment service', async () => {
    const f = await setup();
    expect(fields(await confirmAccountForYear(f.deps, f.ctx, { fiscalYearId: f.y2025, accountId: f.second.id, kind: 'missingJustified' }))).toEqual(['note:required']);
    expect(code(await confirmAccountForYear(f.deps, f.ctx, { fiscalYearId: f.y2025, accountId: f.second.id, kind: 'notReconcilable' }))).toBe('accountKindMismatch');
    expect(code(await confirmAccountForYear(f.deps, f.ctx, { fiscalYearId: f.y2025, accountId: f.paypal.id, kind: 'missingJustified', note: 'x' }))).toBe('accountKindMismatch');
    unwrap(await confirmAccountForYear(f.deps, f.ctx, { fiscalYearId: f.y2025, accountId: f.second.id, kind: 'missingJustified', note: 'Bank schickt kein PDF' }));
    expect(missingStatementPdfsInternal(f.deps.db, f.y2025).map((a) => a.name)).toEqual(['Vereinskonto']);
    unwrap(await confirmAccountForYear(f.deps, f.ctx, { fiscalYearId: f.y2025, accountId: f.paypal.id, kind: 'notReconcilable' }));
    expect(accountStatementsForYearInternal(f.deps.db, f.y2025).find((r) => r.accountId === f.paypal.id)?.confirmation).toMatchObject({ kind: 'notReconcilable', note: null, byUserId: f.userId });
    expect(JSON.parse(auditEntry(f.deps, 'finance.account.yearConfirm').params!)).toEqual({ designation: '2025', kind: 'notReconcilable' });
    const mcp = { ...f.ctx, channel: 'mcp' as const };
    expect(code(await confirmAccountForYear(f.deps, mcp, { fiscalYearId: f.y2025, accountId: f.paypal.id, kind: 'balanceConfirmed' }))).toBe('humanOnly');
    allowHumanOnlyOverMcp(f.deps);
    expect(code(await confirmAccountForYear(f.deps, { ...ctxWith(['finance.read'], f.userId), channel: 'mcp' }, { fiscalYearId: f.y2025, accountId: f.paypal.id, kind: 'balanceConfirmed' }))).toBe('forbidden');
  });

  it('suggests the period from the pdf text', async () => {
    const f = await setup();
    Object.assign(f.deps, { textExtraction: fakeTextExtraction({ pages: [{ page: 1, text: 'Kontoauszug vom 01.12.2025 bis 30.12.2025', source: 'layer' }] }) });
    expect(unwrap(await suggestStatementPeriod(f.deps, f.ctx, { fiscalYearId: f.y2025, accountId: f.second.id, bytes: pdfBytes() }))).toEqual({ periodFrom: '2025-12-01', periodTo: '2025-12-30', covers: true, balanceAtYearEndCents: 1000 });
    Object.assign(f.deps, { textExtraction: fakeTextExtraction({ probe: { ok: false, error: 'missing' } }) });
    expect(unwrap(await suggestStatementPeriod(f.deps, f.ctx, { fiscalYearId: f.y2025, accountId: f.second.id, bytes: pdfBytes() }))).toBeNull();
  });
});

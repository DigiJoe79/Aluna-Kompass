import { newId, unwrap, type CallContext } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { contactRoles, createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveAssemblyResult } from '../src/closing/assembly';
import { confirmClosingStep } from '../src/closing/confirmations';
import { countCashForHandover, fileHandoverProtocol, recordHandoverInterimReport, startHandover } from '../src/closing/handover';
import { getClosingStatus } from '../src/closing/status';
import { createAccount } from '../src/ledger/accounts';
import { bookEntry } from '../src/ledger/finalize';
import { financeRetentionHolds } from '../src/ledger/holds';
import { accountStatementsForYearInternal, confirmAccountForYear, fileAccountStatementDocument, linkAccountStatementDocument } from '../src/ledger/statement-documents';
import { financeAccountStatementDocuments } from '../src/schema';
import { insertDocument, ledgerFixture, pdfBytes } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));

describe('Schlussdurchsicht C1', () => {
  it('I1: a cash box opened after the year end needs no count at that year end', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    await createAccount(f.deps, f.ctx, { name: 'Neue Kasse', kind: 'cash', openingBalanceCents: 0, openingDate: '2026-02-01' }).then(unwrap);
    const cash = unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: f.years['2025']!.id })).steps.find((s) => s.key === 'cash')!;
    expect(cash.facts.key === 'cash' && cash.facts.accounts.map((a) => a.name)).toEqual(['Barkasse']);
  });

  it('I3: handover persons, contact witnesses and discharged persons are held', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const contactCtx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
    const person = async (lastName: string) => unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Testa', lastName }));
    const from = await person('Von');
    const to = await person('An');
    const board = await person('Vorstand');
    f.deps.db.insert(contactRoles).values({ id: newId(), contactId: board.id, role: 'board-member', since: '2020-01-01', until: null, note: null }).run();
    // Die Kasse braucht Bestand am Übergabetag, sonst muss sie nicht gezählt werden (14c).
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende bar', moneyLines: [{ accountId: f.cash.id, amountCents: 500 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 500 }] }));
    const h = unwrap(await startHandover(f.deps, f.ctx, { handoverOn: '2026-06-30', fromContactId: from.id, toContactId: to.id }));
    unwrap(await countCashForHandover(f.deps, f.ctx, { id: h.id, accountId: f.cash.id, countedCents: 500, counterOneContactId: from.id, counterTwoContactId: f.donor.id }));
    f.closeYear(f.years['2025']!.id);
    unwrap(await saveAssemblyResult(f.deps, f.ctx, { fiscalYearId: f.years['2025']!.id, assemblyOn: '2026-03-14', dischargeMode: 'individual', discharges: [{ contactId: board.id, outcome: 'granted' }] }));
    const entities = (id: string) => financeRetentionHolds(f.deps, 'contact', id).map((x) => x.entity).sort();
    expect(entities(from.id)).toContain('financeHandover');
    expect(entities(to.id)).toEqual(expect.arrayContaining(['financeHandover', 'financeCashCount']));
    expect(entities(board.id)).toContain('financeAssemblyResult');
  });

  it('M1: step 1 needs the balance or a confirmation for each payment service', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const service = unwrap(await createAccount(f.deps, f.ctx, { name: 'Bezahldienst', kind: 'paymentService' }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-05-01', text: 'Spende', moneyLines: [{ accountId: service.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100 }] }));
    const y = f.years['2025']!.id;
    unwrap(await confirmClosingStep(f.deps, f.ctx, { fiscalYearId: y, step: 'statements' }));
    const step1 = async () => unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: y })).steps[0]!.done;
    expect(await step1()).toBe(false);
    unwrap(await confirmAccountForYear(f.deps, f.ctx, { fiscalYearId: y, accountId: service.id, kind: 'notReconcilable' }));
    expect(await step1()).toBe(true);
  });

  it('M2: a statement without start running into January covers the year it closes and is linked to it', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100 }] }));
    const filed = unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, periodTo: '2026-01-05', bytes: pdfBytes() }));
    expect(accountStatementsForYearInternal(f.deps.db, f.years['2025']!.id)[0]).toMatchObject({ needsPdf: false, statement: { documentId: filed.documentId, covers: true } });
    const years = f.deps.sqlite.prepare("select entity_id as id from document_links where document_id = ? and entity_type = 'financeFiscalYear'").all(filed.documentId).map((r) => (r as { id: string }).id).sort();
    expect(years).toEqual([f.years['2025']!.id, f.years['2026']!.id].sort());
  });

  it('M5: a handover is counted once', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const contactCtx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
    const to = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Testa', lastName: 'An' }));
    // Die Kasse braucht Bestand am Übergabetag, sonst muss sie nicht gezählt werden (14c).
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende bar', moneyLines: [{ accountId: f.cash.id, amountCents: 500 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 500 }] }));
    const h = unwrap(await startHandover(f.deps, f.ctx, { handoverOn: '2026-06-30', fromContactId: f.donor.id, toContactId: to.id }));
    const count = () => countCashForHandover(f.deps, f.ctx, { id: h.id, accountId: f.cash.id, countedCents: 500, counterOneContactId: f.donor.id, counterTwoContactId: f.wrongDonor.id });
    unwrap(await count());
    expect(code(await count())).toBe('handoverCashCounted');
    void recordHandoverInterimReport; void fileHandoverProtocol;
  });

  it('M6: linking the same statement twice keeps one row', async () => {
    const f = await ledgerFixture();
    const doc = insertDocument(f, { subject: 'Auszug', typeKey: 'bank-statement' });
    unwrap(await linkAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, documentId: doc, periodTo: '2026-03-31' }));
    unwrap(await linkAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, documentId: doc, periodTo: '2026-03-31' }));
    expect(f.deps.db.select().from(financeAccountStatementDocuments).where(eq(financeAccountStatementDocuments.documentId, doc)).all()).toHaveLength(1);
  });
});

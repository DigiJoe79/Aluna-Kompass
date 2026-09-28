import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { recordReserveMovement, saveReserve } from '../src/allocation/reserves';
import { approvePurposeTransfer, requestPurposeTransfer } from '../src/allocation/transfers';
import { bookEntry } from '../src/ledger/finalize';
import { fulfillPurpose } from '../src/ledger/purposes';
import { assetOverviewAt, incomeStatement } from '../src/ledger/queries';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeAllocationLines, financeEntries } from '../src/schema';
import { insertDocument, ledgerFixture } from './helpers';

const withDms = (f: Awaited<ReturnType<typeof ledgerFixture>>) => ctxWith([...FINANCE_PERMISSIONS, 'dms.view'], f.userId);

/** Spec 2026-09-20 § 2 E5/E18/E21, § 11.2 Prüfsteine 8 und 9 (F8b). */
describe('Prüfstein 8 — zurückgelegtes Geld bewegt nie ein Bankkonto oder eine Kasse, keine Zeile, keine EÜR', () => {
  it('a movement of reserved funds never touches a money account, a line, or the EÜR', async () => {
    const f = await ledgerFixture();
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const bankBefore = assetOverviewAt(f.deps.db, '2026-12-31').accounts;
    const statementBefore = incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    const entryCountBefore = f.deps.db.select().from(financeEntries).all().length;
    const lineCountBefore = f.deps.db.select().from(financeAllocationLines).all().length;

    const reserve = unwrap(await saveReserve(f.deps, withDms(f), { kind: 'free', name: 'Freie Rücklage', resolutionDocumentId: docId }));
    unwrap(await recordReserveMovement(f.deps, withDms(f), { reserveId: reserve.id, kind: 'allocate', movementDate: '2026-03-05', amountCents: 5000, capReason: 'Test: ohne Einnahmen ist der Höchstbetrag 0', resolutionDocumentId: docId }));

    expect(assetOverviewAt(f.deps.db, '2026-12-31').accounts).toEqual(bankBefore);
    expect(incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' })).toEqual(statementBefore);
    expect(f.deps.db.select().from(financeEntries).all().length).toBe(entryCountBefore);
    expect(f.deps.db.select().from(financeAllocationLines).all().length).toBe(lineCountBefore);
  });
});

describe('Prüfstein 9 — erfüllter Zweck mit Rest, Umwidmung nach freien Mitteln freigegeben', () => {
  it('rest goes to zero, free funds rise by the rest, accounts and the EÜR stay unchanged', async () => {
    const f = await ledgerFixture();
    const { createPurpose } = await import('../src/ledger/purposes');
    const purpose = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Zweck mit Rest' }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 12000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 12000, purposeId: purpose.id }] }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-10', text: 'Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -9000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -9000, purposeId: purpose.id }] }));
    unwrap(await fulfillPurpose(f.deps, f.ctx, { id: purpose.id }));

    const accountsBefore = assetOverviewAt(f.deps.db, '2026-12-31').accounts;
    const statementBefore = incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    const freeBefore = assetOverviewAt(f.deps.db, '2026-12-31').freeCents;

    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const transfer = unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: purpose.id, toPurposeId: null, amountCents: 3000, transferDate: '2026-03-01', reason: 'Rest umwidmen', documentId: docId }));
    unwrap(await approvePurposeTransfer(f.deps, f.secondPerson, { id: transfer.id }));

    const overview = assetOverviewAt(f.deps.db, '2026-12-31');
    expect(overview.accounts).toEqual(accountsBefore);
    expect(incomeStatement(f.deps.db, { from: '2026-01-01', to: '2026-12-31' })).toEqual(statementBefore);
    expect(overview.freeCents).toBe(freeBefore + 3000);
  });
});

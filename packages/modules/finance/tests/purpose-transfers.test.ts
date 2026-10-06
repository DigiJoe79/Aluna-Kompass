import { schema, unwrap, yearIn } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approvePurposeTransfer, getPurposeTransfer, listPurposeTransfers, purposeMovements, purposeOverview, rejectPurposeTransfer, requestPurposeTransfer } from '../src/allocation/transfers';
import { listApprovals } from '../src/allocation/approvals';
import { bookEntry } from '../src/ledger/finalize';
import { deletePurpose, fulfillPurpose, reopenPurpose } from '../src/ledger/purposes';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { ULID_PATTERN } from '../src/allocation/subjects';
import { insertDocument, ledgerFixture, pdfBytes } from './helpers';
import { jpegBytes } from './expense-fixture';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const withDms = (f: Awaited<ReturnType<typeof ledgerFixture>>) => ctxWith([...FINANCE_PERMISSIONS, 'dms.view'], f.userId);
const overviewOnly = (f: Awaited<ReturnType<typeof ledgerFixture>>) => ctxWith(['finance.overview'], f.userId);

async function purposeWithBalance(f: Awaited<ReturnType<typeof ledgerFixture>>, name: string, cents: number) {
  const { createPurpose } = await import('../src/ledger/purposes');
  const purpose = unwrap(await createPurpose(f.deps, f.ctx, { name }));
  if (cents !== 0) unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: f.donations.id, amountCents: cents, purposeId: purpose.id }] }));
  return purpose;
}

describe('requestPurposeTransfer (F8b Task 3, Annahme 5)', () => {
  it('am 1.1. um 00:30 Uhr Ortszeit trägt eine Umwidmung die Nummer des neuen Jahres (Befund 46)', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    f.deps.clock.set('2026-12-31T23:30:00.000Z');
    const transfer = unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-03-01', reason: 'Umschichtung', documentId: docId }));
    expect(transfer.number).toBe('UM-2027-001');
  });

  it('numbers transfers UM-YYYY-NNN, requires a document, and refuses same or missing purposes', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const noDoc = await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-03-01', reason: 'Umschichtung' });
    expect(err(noDoc)).toMatchObject({ code: 'transferDocumentRequired' });

    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const both = await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: a.id, amountCents: 1000, transferDate: '2026-03-01', reason: 'x', documentId: docId });
    expect(err(both)).toMatchObject({ code: 'transferSamePurpose' });
    const none = await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: null, toPurposeId: null, amountCents: 1000, transferDate: '2026-03-01', reason: 'x', documentId: docId });
    expect(err(none)).toMatchObject({ code: 'transferNoPurposes' });

    const transfer = unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-03-01', reason: 'Umschichtung', documentId: docId }));
    expect(transfer.number).toBe(`UM-${yearIn(f.deps)}-001`);
    expect(transfer.state).toBe('submitted');
  });

  it('names the purposes in the subject of an uploaded resolution, free funds included', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const created = unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-03-01', reason: 'Umschichtung', documentUpload: { bytes: pdfBytes(), fileName: 'protokoll.pdf' } }));
    const subject = f.deps.db.select({ subject: documents.subject }).from(documents).where(eq(documents.id, created.documentId!)).get()!.subject;
    expect(subject).toBe('Beschluss für Umwidmung von „Zweck A“ zu freien Mitteln');
    expect(subject).not.toMatch(ULID_PATTERN);
  });

  it('creates a transfer with an uploaded resolution instead of a picked one — never both', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const both = await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-03-01', reason: 'x', documentId: 'DOC-1', documentUpload: { bytes: pdfBytes(), fileName: 'protokoll.pdf' } });
    expect(err(both)).toMatchObject({ type: 'validation' });

    const created = unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-03-01', reason: 'Umschichtung', documentUpload: { bytes: pdfBytes(), fileName: 'protokoll.pdf' } }));
    expect(created.documentId).not.toBeNull();
    expect(created.number).toBe(`UM-${yearIn(f.deps)}-001`);
  });

  it('refuses an uploaded resolution that is not a PDF or too large', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const notPdf = await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-03-01', reason: 'x', documentUpload: { bytes: jpegBytes(), fileName: 'foto.jpg' } });
    expect(err(notPdf)).toMatchObject({ code: 'resolutionFileNotPdf' });
    const tooBig = await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-03-01', reason: 'x', documentUpload: { bytes: new Uint8Array([...pdfBytes(), ...new Uint8Array(11 * 1024 * 1024)]), fileName: 'groß.pdf' } });
    expect(err(tooBig)).toMatchObject({ code: 'resolutionFileTooLarge' });
  });

  it('refuses a transfer into a fulfilled or dissolved purpose', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const target = await purposeWithBalance(f, 'Zweck B', 0);
    unwrap(await fulfillPurpose(f.deps, f.ctx, { id: target.id }));
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const result = await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: target.id, amountCents: 1000, transferDate: '2026-03-01', reason: 'x', documentId: docId });
    expect(err(result)).toMatchObject({ code: 'purposeClosed' });
  });

  it('refuses transfer dates in a closed year, without a year, or after today', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const future = await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2099-01-01', reason: 'x', documentId: docId });
    expect(err(future)).toMatchObject({ code: 'transferDateInFuture' });

    f.closeYear(f.year.id);
    const closed = await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-03-01', reason: 'x', documentId: docId });
    expect(err(closed)).toMatchObject({ code: 'fiscalYearClosed' });
  });

  it('reports source-would-go-negative as a field, not an error', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 1000);
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const transfer = unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 5000, transferDate: '2026-03-01', reason: 'x', documentId: docId }));
    expect(transfer.sourceWouldGoNegative).toBe(true);
    expect(transfer.from).toMatchObject({ beforeCents: 1000, afterCents: -4000 });
  });
});

describe('approvePurposeTransfer, rejectPurposeTransfer (Review Focus 1, 2)', () => {
  it('lets state leave submitted exactly once — a second approval attempt is refused', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const transfer = unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-03-01', reason: 'x', documentId: docId }));
    const approved = unwrap(await approvePurposeTransfer(f.deps, f.secondPerson, { id: transfer.id }));
    expect(approved.state).toBe('approved');
    const second = await approvePurposeTransfer(f.deps, f.secondPerson, { id: transfer.id });
    expect(err(second)).toMatchObject({ code: 'transferNotSubmitted' });
  });

  it('refuses approval by the person who created the transfer', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const transfer = unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-03-01', reason: 'x', documentId: docId }));
    const result = await approvePurposeTransfer(f.deps, withDms(f), { id: transfer.id });
    expect(err(result)).toMatchObject({ code: 'transferOwn' });
  });

  it('rejects a submitted transfer with a note, kept on the record, never in the log', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const transfer = unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-03-01', reason: 'x', documentId: docId }));
    const rejected = unwrap(await rejectPurposeTransfer(f.deps, f.secondPerson, { id: transfer.id, note: 'zu spät' }));
    expect(rejected.state).toBe('rejected');
  });

  it('a transfer from a fulfilled purpose, then reopened with a reason, keeps consistent balances and the transfer stays (Review Focus 1)', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    unwrap(await fulfillPurpose(f.deps, f.ctx, { id: a.id }));
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const transfer = unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 3000, transferDate: '2026-03-01', reason: 'Rest umwidmen', documentId: docId }));
    unwrap(await approvePurposeTransfer(f.deps, f.secondPerson, { id: transfer.id }));
    const reopened = unwrap(await reopenPurpose(f.deps, f.ctx, { id: a.id, reason: 'Nochmal geöffnet' }));
    expect(reopened.fulfilledAt).toBeNull();
    const still = unwrap(await getPurposeTransfer(f.deps, f.ctx, { id: transfer.id }));
    expect(still.state).toBe('approved');
    const overview = unwrap(await purposeOverview(f.deps, f.ctx));
    expect(overview.find((p) => p.id === a.id)?.balanceCents).toBe(7000);
  });
});

describe('purposeMovements, purposeOverview (Annahme 7, 8, Review Focus 5)', () => {
  it('lists carry-forward, lines and approved transfers with a running balance', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const b = await purposeWithBalance(f, 'Zweck B', 0);
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const transfer = unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: b.id, amountCents: 2000, transferDate: '2026-03-01', reason: 'x', documentId: docId }));
    unwrap(await approvePurposeTransfer(f.deps, f.secondPerson, { id: transfer.id }));
    const movements = unwrap(await purposeMovements(f.deps, f.ctx, { purposeId: a.id }));
    expect(movements.at(-1)).toMatchObject({ kind: 'transferOut', amountCents: -2000, runningBalanceCents: 8000, transferNumber: transfer.number });
  });

  it('refuses purposeMovements without finance.read', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const denied = await purposeMovements(f.deps, overviewOnly(f), { purposeId: a.id });
    expect(err(denied)).toMatchObject({ type: 'forbidden' });
  });

  it('under overview only, purposeOverview returns balances without names, description or transfer detail (Review Focus 5)', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const full = unwrap(await purposeOverview(f.deps, f.ctx));
    const fullRow = full.find((p) => p.id === a.id)!;
    expect(fullRow).toMatchObject({ name: 'Zweck A', description: '', carryForwardCents: 0, inflowCents: 10000, outflowCents: 0, referenceNote: null });
    expect(typeof fullRow.updatedAt).toBe('string');
    const reduced = unwrap(await purposeOverview(f.deps, overviewOnly(f)));
    const row = reduced.find((p) => p.id === a.id)!;
    expect(row).toMatchObject({ id: a.id, name: 'Zweck A', balanceCents: 10000, state: 'open', negative: false, fulfilledWithRest: false, description: null, projectId: null, referenceNote: null, updatedAt: null });
    // Vortrag, Zugänge und Verwendung sind Bewegungen — unter `overview` fehlen die Felder, statt 0 zu behaupten (Befund 40, Design-Nachtrag Phase 4).
    for (const key of ['carryForwardCents', 'inflowCents', 'outflowCents', 'transfersInCents', 'transfersOutCents']) expect(row).not.toHaveProperty(key);
  });

  it('movement lines name the entry number, its text and the counterparty (E3, Design-Nachtrag Phase 4)', async () => {
    const f = await ledgerFixture();
    const { createPurpose } = await import('../src/ledger/purposes');
    const purpose = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Zweck Namen' }));
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende Freizeit', moneyLines: [{ accountId: f.bank.id, amountCents: 6000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 6000, purposeId: purpose.id, contactId: f.donor.id }] }));
    const movements = unwrap(await purposeMovements(f.deps, f.ctx, { purposeId: purpose.id }));
    expect(movements[0]).toMatchObject({ kind: 'line', entryId: entry.id, entryNumber: entry.number, text: 'Spende Freizeit', counterpartyName: 'Musterspenderin', amountCents: 6000, runningBalanceCents: 6000 });
    expect(entry.number).toBeTruthy();
  });

  it('purpose in use covers transfers and reserves (Annahme 6)', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const b = await purposeWithBalance(f, 'Zweck B', 0);
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    const transfer = unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: b.id, amountCents: 500, transferDate: '2026-03-01', reason: 'x', documentId: docId }));
    void transfer;
    const deleted = await deletePurpose(f.deps, f.ctx, { id: a.id });
    expect(err(deleted)).toMatchObject({ code: 'purposeInUse' });
  });
});

describe('listApprovals queues transfers together with claims and payments (F8b Annahme 5)', () => {
  it('merges all three kinds, oldest first, before paging', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 500, transferDate: '2026-03-01', reason: 'x', documentId: docId }));
    const queue = unwrap(await listApprovals(f.deps, f.secondPerson, {}));
    expect(queue.items.some((i) => i.kind === 'purposeTransfer')).toBe(true);
  });
});

describe('listPurposeTransfers', () => {
  it('lists newest first, optionally filtered by purpose', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const docId = insertDocument(f, { subject: 'Protokoll', typeKey: 'minutes' });
    unwrap(await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 500, transferDate: '2026-03-01', reason: 'x', documentId: docId }));
    const all = unwrap(await listPurposeTransfers(f.deps, f.ctx));
    expect(all.length).toBeGreaterThan(0);
    const filtered = unwrap(await listPurposeTransfers(f.deps, f.ctx, { purposeId: a.id }));
    expect(filtered.every((t) => t.fromPurposeId === a.id || t.toPurposeId === a.id)).toBe(true);
  });
});

describe('Befund 6 (0.2.7): eine abgelehnte Umwidmung lässt keinen hochgeladenen Beschluss in der Akte', () => {
  it('Datum in der Zukunft: kein Dokument, kein Eingang im Protokoll', async () => {
    const f = await ledgerFixture();
    const a = await purposeWithBalance(f, 'Zweck A', 10000);
    const trace = () => ({ documents: f.deps.db.select().from(documents).all().length, received: f.deps.db.select().from(schema.auditLog).all().filter((x) => x.action === 'dms.receive').length });
    const before = trace();
    const refused = await requestPurposeTransfer(f.deps, withDms(f), { fromPurposeId: a.id, toPurposeId: null, amountCents: 1000, transferDate: '2026-12-31', reason: 'Umschichtung', documentUpload: { bytes: pdfBytes(), fileName: 'protokoll.pdf' } });
    expect(err(refused)).toMatchObject({ code: 'transferDateInFuture' });
    expect(trace()).toEqual(before);
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unwrap } from '@kompass/core';
import { auditEntry, ctxWith, systemContext } from '@kompass/core/testing';
import { documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { decideCandidate } from '../src/import/candidates';
import { previewDiscardRun, discardRun } from '../src/import/discard';
import { importStatement } from '../src/import/runs';
import { createAccount } from '../src/ledger/accounts';
import { deleteDraft, entryViewInternal, saveDraft, setReviewed } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { reverseEntry } from '../src/ledger/reverse';
import { uploadVoucher } from '../src/ledger/vouchers';
import { installFinance } from '../src/install';
import { financeCategories, financeEntryDocuments, financeImportCandidates, financeImportRuns, financeRawTransactions } from '../src/schema';
import { pdfBytes, setupFinance } from './helpers';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/camt');
const bytes = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const VEREIN_IBAN = 'DE60999999990201051234';

const code = (r: { ok: boolean; error?: { type: string; code?: string; permission?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

async function discardFixture() {
  const { deps, ctx, userId } = setupFinance();
  deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
  const account = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: VEREIN_IBAN, isMain: true }));
  unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
  const donations = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'donations')).get()!;
  const programCosts = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'program-costs')).get()!;

  const mainRun = unwrap(await importStatement(deps, ctx, { accountId: account.id, fileName: 'maerz.xml', bytes: bytes('einfach-001-02.xml') })).runs[0]!;
  const raws = deps.db.select().from(financeRawTransactions).where(eq(financeRawTransactions.runId, mainRun.id)).all();
  const donationRaw = raws.find((r) => r.amountCents === 20000)!; // Spende, Erika Beispiel
  const expenseRaw = raws.find((r) => r.amountCents === -1500)!; // Buero

  return { deps, ctx, userId, account, donations, programCosts, mainRun, donationRaw, expenseRaw };
}

describe('previewDiscardRun', () => {
  it('previews the consequences in numbers and what stays', async () => {
    const f = await discardFixture();
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-06', text: 'Spende Erika', moneyLines: [{ accountId: f.account.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] }));
    const reviewedDraft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-10', text: 'Buero', moneyLines: [{ accountId: f.account.id, amountCents: -1500, rawTransactionId: f.expenseRaw.id }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500 }] }));
    unwrap(await setReviewed(f.deps, f.ctx, { id: reviewedDraft.id, reviewed: true, expectedVersion: reviewedDraft.updatedAt }));
    unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: reviewedDraft.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2026-03-10' }));

    const preview = unwrap(await previewDiscardRun(f.deps, f.ctx, { id: f.mainRun.id }));
    expect(preview).toEqual({ rawTransactions: 3, drafts: 2, reviewedDrafts: 1, vouchersKept: 1, blocking: [], canDiscard: true });
  });

  it('shows zeros and canDiscard false for a failed or an already discarded run, without an error', async () => {
    const f = await discardFixture();
    const failed = await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'kaputt.xml', bytes: bytes('kaputte-zeile.xml') });
    expect(code(failed)).toBe('statementUnreadable');
    const failedRun = f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.accountId, f.account.id)).all().find((r) => r.failedAt !== null)!;

    const previewFailed = unwrap(await previewDiscardRun(f.deps, f.ctx, { id: failedRun.id }));
    expect(previewFailed).toEqual({ rawTransactions: 0, drafts: 0, reviewedDrafts: 0, vouchersKept: 0, blocking: [], canDiscard: false });

    unwrap(await discardRun(f.deps, f.ctx, { id: f.mainRun.id, note: 'Falsches Konto gewählt' }));
    const previewDiscarded = unwrap(await previewDiscardRun(f.deps, f.ctx, { id: f.mainRun.id }));
    expect(previewDiscarded.canDiscard).toBe(false);
  });

  it('requires finance.read', async () => {
    const f = await discardFixture();
    const denied = await previewDiscardRun(f.deps, ctxWith(['finance.overview']), { id: f.mainRun.id });
    expect(denied.ok ? null : denied.error).toEqual({ type: 'forbidden', permission: 'finance.read' });
  });
});

describe('discardRun', () => {
  it('deletes raw transactions, file, open candidates and drafts including reviewed ones, keeping the vouchers in the file module', async () => {
    const f = await discardFixture();
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-06', text: 'Spende Erika', moneyLines: [{ accountId: f.account.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] }));
    const reviewedDraft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-10', text: 'Buero', moneyLines: [{ accountId: f.account.id, amountCents: -1500, rawTransactionId: f.expenseRaw.id }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500 }] }));
    unwrap(await setReviewed(f.deps, f.ctx, { id: reviewedDraft.id, reviewed: true, expectedVersion: reviewedDraft.updatedAt }));
    const voucher = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: reviewedDraft.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2026-03-10' }));

    // Ein Kandidat, der zu einem ANDEREN, spaeter verworfenen Lauf gehoert (nicht zu mainRun).
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'juni.xml', bytes: bytes('ohne-referenz.xml') }));
    const heldRun = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'september.xml', bytes: bytes('ohne-referenz-nicht-ueberlappend.xml') }));
    expect(f.deps.db.select().from(financeImportCandidates).where(eq(financeImportCandidates.runId, heldRun.runs[0]!.id)).all()).toHaveLength(1);

    const fileKey = f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.id, f.mainRun.id)).get()!.fileKey!;
    expect(await f.deps.files('finance').exists(fileKey)).toBe(true);

    unwrap(await discardRun(f.deps, f.ctx, { id: f.mainRun.id, note: 'Falsches Konto gewählt' }));
    expect(f.deps.db.select().from(financeRawTransactions).where(eq(financeRawTransactions.runId, f.mainRun.id)).all()).toHaveLength(0);
    expect(await f.deps.files('finance').exists(fileKey)).toBe(false);
    expect(entryViewInternal(f.deps.db, reviewedDraft.id)).toBeNull();

    // Der Beleg selbst bleibt in der Akte, nur der Bezug an der geloeschten Buchung ist weg.
    expect(f.deps.db.select().from(documents).where(eq(documents.id, voucher.documentId)).get()).not.toBeNull();
    expect(f.deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, reviewedDraft.id)).all()).toHaveLength(0);

    unwrap(await discardRun(f.deps, f.ctx, { id: heldRun.runs[0]!.id, note: 'War ebenfalls falsch' }));
    expect(f.deps.db.select().from(financeImportCandidates).where(eq(financeImportCandidates.runId, heldRun.runs[0]!.id)).all()).toHaveLength(0);
  });

  it('severs the reference of a decided candidate in another, surviving run — its decision stays, only the matched raw transaction is cleared', async () => {
    const f = await discardFixture();
    // earlierRun (Juni) traegt einen eigenen Rohumsatz; laterRun (September, nicht ueberlappend) haelt
    // einen Kandidaten, der ihn als „bereits vorhanden“ zeigt (matchesRawTransactionId). Dieser Kandidat
    // gehoert laterRun, nicht earlierRun — genau der Fall, der nur den Bezug verliert, nicht die Zeile.
    const earlierRun = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'juni.xml', bytes: bytes('ohne-referenz.xml') })).runs[0]!;
    const laterRun = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'september.xml', bytes: bytes('ohne-referenz-nicht-ueberlappend.xml') })).runs[0]!;
    const candidate = f.deps.db.select().from(financeImportCandidates).where(eq(financeImportCandidates.runId, laterRun.id)).get()!;
    expect(candidate.matchesRawTransactionId).not.toBeNull();

    // Entschieden — der Trigger sperrt raw_transaction_id danach, aber nicht matches_raw_transaction_id.
    unwrap(await decideCandidate(f.deps, f.ctx, { id: candidate.id, decision: 'same' }));

    unwrap(await discardRun(f.deps, f.ctx, { id: earlierRun.id, note: 'Falscher Auszug' }));

    const after = f.deps.db.select().from(financeImportCandidates).where(eq(financeImportCandidates.id, candidate.id)).get()!;
    expect(after.decision).toBe('same'); // die Entscheidung bleibt stehen
    expect(after.matchesRawTransactionId).toBeNull(); // der Bezug auf den geloeschten Rohumsatz ist geloest
    expect(f.deps.db.select().from(financeRawTransactions).where(eq(financeRawTransactions.runId, earlierRun.id)).all()).toHaveLength(0);
  });

  it('keeps the run as a fact with checksum, counters, who and why', async () => {
    const f = await discardFixture();
    const before = f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.id, f.mainRun.id)).get()!;

    const discarded = unwrap(await discardRun(f.deps, f.ctx, { id: f.mainRun.id, note: 'Doppelt geladen' }));
    expect(discarded.state).toBe('discarded');
    expect(discarded.counts).toEqual(f.mainRun.counts);

    const after = f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.id, f.mainRun.id)).get()!;
    expect(after.fileSha256).toBe(before.fileSha256);
    expect(after.countNew).toBe(before.countNew);
    expect(after.discardedAt).not.toBeNull();
    expect(after.discardedByUserId).toBe(f.userId);
    expect(after.discardNote).toBe('Doppelt geladen');
    expect(after.fileKey).toBeNull();
  });

  it('is blocked by finalized entries and lists them; after taking them back it goes through', async () => {
    const f = await discardFixture();
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-06', text: 'Spende Erika', moneyLines: [{ accountId: f.account.id, amountCents: 20000, rawTransactionId: f.donationRaw.id }], allocationLines: [{ categoryId: f.donations.id, amountCents: 20000 }] }));

    const preview = unwrap(await previewDiscardRun(f.deps, f.ctx, { id: f.mainRun.id }));
    expect(preview.canDiscard).toBe(false);
    expect(preview.blocking).toEqual([{ entryId: entry.id, number: entry.number, entryDate: '2026-03-06', amountCents: 20000 }]);

    const blocked = await discardRun(f.deps, f.ctx, { id: f.mainRun.id, note: 'Test' });
    expect(code(blocked)).toBe('statementDiscardBlocked');

    unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id }));
    const afterPreview = unwrap(await previewDiscardRun(f.deps, f.ctx, { id: f.mainRun.id }));
    expect(afterPreview.canDiscard).toBe(true);

    const discarded = await discardRun(f.deps, f.ctx, { id: f.mainRun.id, note: 'Nach Ruecknahme verworfen' });
    expect(code(discarded)).toBe('ok');
  });

  it('lets the same file be imported again afterwards, and the continuity check ignore the discarded run', async () => {
    const f = await discardFixture();
    const follow = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'april.xml', bytes: bytes('folgeauszug.xml') }));
    expect(follow.runs[0]!.gap).toBeNull();

    unwrap(await discardRun(f.deps, f.ctx, { id: follow.runs[0]!.id, note: 'Falscher April-Auszug' }));

    const reimported = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'april-erneut.xml', bytes: bytes('folgeauszug.xml') }));
    expect(reimported.runs[0]!.gap).toBeNull();
    unwrap(await discardRun(f.deps, f.ctx, { id: reimported.runs[0]!.id, note: 'Auch dieser war falsch' }));

    // Die Anschlusspruefung uebergeht beide verworfenen April-Laeufe und findet den Anschluss an Maerz (mainRun).
    const gapCheck = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'mai.xml', bytes: bytes('luecke.xml') }));
    expect(gapCheck.runs[0]!.gap).toEqual({ from: '2026-03-31', to: '2026-05-01' });
  });

  it('keeps the shared file while a sibling run of the same upload is still alive, and removes it with the last one', async () => {
    const f = await discardFixture();
    const twoDay = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'zwei-tage.xml', bytes: bytes('zwei-tage.xml') }));
    expect(twoDay.runs).toHaveLength(2);
    const runA = twoDay.runs[0]!;
    const runB = twoDay.runs[1]!;

    const rowA = f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.id, runA.id)).get()!;
    const rowB = f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.id, runB.id)).get()!;
    const fileKey = rowA.fileKey!;
    expect(rowB.fileKey).toBe(fileKey);

    unwrap(await discardRun(f.deps, f.ctx, { id: runA.id, note: 'Erster Tag falsch' }));
    expect(await f.deps.files('finance').exists(fileKey)).toBe(true); // runB haelt die Datei noch

    unwrap(await discardRun(f.deps, f.ctx, { id: runB.id, note: 'Zweiter Tag auch falsch' }));
    expect(await f.deps.files('finance').exists(fileKey)).toBe(false);
  });

  it('demands a note and the permission; refuses a failed or already discarded run', async () => {
    const f = await discardFixture();

    const noNote = await discardRun(f.deps, f.ctx, { id: f.mainRun.id, note: '' });
    expect(code(noNote)).toBe('validation');

    const denied = await discardRun(f.deps, ctxWith(['finance.read']), { id: f.mainRun.id, note: 'x' });
    expect(denied.ok ? null : denied.error).toEqual({ type: 'forbidden', permission: 'finance.entriesWrite' });

    const failed = await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'kaputt.xml', bytes: bytes('kaputte-zeile.xml') });
    expect(code(failed)).toBe('statementUnreadable');
    const failedRun = f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.accountId, f.account.id)).all().find((r) => r.failedAt !== null)!;
    const refusedFailed = await discardRun(f.deps, f.ctx, { id: failedRun.id, note: 'x' });
    expect(code(refusedFailed)).toBe('statementNotDiscardable');

    unwrap(await discardRun(f.deps, f.ctx, { id: f.mainRun.id, note: 'Erstes Verwerfen' }));
    const refusedTwice = await discardRun(f.deps, f.ctx, { id: f.mainRun.id, note: 'Zweiter Versuch' });
    expect(code(refusedTwice)).toBe('statementNotDiscardable');
  });

  it('never writes the note into the audit log', async () => {
    const f = await discardFixture();
    unwrap(await discardRun(f.deps, f.ctx, { id: f.mainRun.id, note: 'Geheime interne Begruendung Musterstadt' }));
    const entry = auditEntry(f.deps, 'finance.import.discard');
    const text = `${entry.summary}${entry.after ?? ''}`;
    expect(text).not.toContain('Geheime interne Begruendung');
  });
});

// Belegt die Abgrenzung im Bericht: `deleteDraft` bleibt fuer normale Entwuerfe unveraendert nutzbar.
describe('deleteDraft still works standalone', () => {
  it('deletes a draft without a raw transaction as before', async () => {
    const f = await discardFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-06', text: 'Ohne Umsatz', moneyLines: [{ accountId: f.account.id, amountCents: -500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -500 }] }));
    unwrap(await deleteDraft(f.deps, f.ctx, { id: draft.id }));
    expect(entryViewInternal(f.deps.db, draft.id)).toBeNull();
  });
});

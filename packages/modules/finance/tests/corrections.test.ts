import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documentTypes, documents } from '@kompass/module-dms';
import { createProject } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  applyCorrectionInternal,
  approveAllocationCorrection,
  listAllocationCorrections,
  rejectAllocationCorrection,
  requestAllocationCorrection,
} from '../src/ledger/corrections';
import { getEntry } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { updateFiscalYear } from '../src/ledger/fiscal-years';
import { createPurpose } from '../src/ledger/purposes';
import { uploadVoucher } from '../src/ledger/vouchers';
import type { EntryLock } from '../src/locks';
import { allowHumanOnlyOverMcp, ledgerFixture, pdfBytes } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const now = '2026-03-01T10:00:00.000Z';

/** Ein festgeschriebenes Dokument der Art `letter` (ohne Bereich) — wie in `vouchers.test.ts`. */
function seedLetter(deps: Awaited<ReturnType<typeof ledgerFixture>>['deps'], id: string) {
  if (!deps.db.select({ key: documentTypes.key }).from(documentTypes).where(eq(documentTypes.key, 'letter')).get()) {
    deps.db.insert(documentTypes).values({ key: 'letter', label: 'Brief', prefix: 'BRF', defaultDirection: 'outgoing', retentionClass: 'statutory6Y', defaultFolder: null, isActive: true, sortOrder: 0, ownerModule: null, protectionArea: null }).run();
  }
  deps.db
    .insert(documents)
    .values({
      id, phase: 'issued', direction: 'outgoing', sourceKind: 'uploaded', typeKey: 'letter', number: `BRF-2026-${id}`, subject: 'Brief', documentDate: '2026-03-01', folder: null,
      draftBody: null, fileName: 'x', fileChecksum: 'abc', fileBytes: 1, textStatus: 'unavailable', textAttempts: 0, textError: null, textExtractedAt: null,
      status: 'issued', createdByUserId: 'U1', createdAt: now, updatedAt: now,
    })
    .run();
}

/** Ein Projekt anlegen, ohne dass `f.ctx` `projects.manage` braucht. */
async function seedProject(deps: Awaited<ReturnType<typeof ledgerFixture>>['deps'], userId: string, slug: string) {
  const manager = ctxWith(['projects.manage'], userId);
  return unwrap(await createProject(deps, manager, { slug, name: { de: 'Testprojekt' }, type: 'ongoing' as const, summary: { de: '' }, body: { de: '' } }));
}

describe('allocation correction', () => {
  it('Prüfstein „falscher Spender im abgeschlossenen Jahr“: a second person approves; the entry keeps its number, date, amount and voucher — only the donor changes', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const entry = await f.finalDonation({ date: '2025-11-03', cents: 25000, contactId: f.wrongDonor.id });
    const voucher = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-receipt', documentDate: '2025-11-03' }));
    f.closeYear(f.years['2025']!.id);
    const line = entry.allocationLines[0]!;

    const requested = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'Überweisung kam vom Ehemann, Spenderin ist die Ehefrau' }));
    expect(requested).toMatchObject({ applied: false, correction: { state: 'pending' } });
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: entry.id })).allocationLines[0]!.contactId).toBe(f.wrongDonor.id); // noch unverändert

    const own = await approveAllocationCorrection(f.deps, f.ctx, { id: requested.correction.id });
    expect(own.ok ? null : own.error).toMatchObject({ type: 'conflict', code: 'ownCorrection' });

    const approved = unwrap(await approveAllocationCorrection(f.deps, f.secondPerson, { id: requested.correction.id }));
    expect(approved).toMatchObject({ state: 'applied', approvedByUserId: f.secondPersonId });
    const after = unwrap(await getEntry(f.deps, f.ctx, { id: entry.id }));
    expect(after.allocationLines[0]!.contactId).toBe(f.rightDonor.id);
    expect([after.number, after.entryDate, after.allocationLines[0]!.amountCents, after.vouchers[0]!.documentId]).toEqual([entry.number, '2025-11-03', 25000, voucher.documentId]);
    expect(JSON.parse(approved.before)).toMatchObject({ contactId: f.wrongDonor.id });
    expect(JSON.parse(approved.after)).toMatchObject({ contactId: f.rightDonor.id });

    const auditRows = f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action.startsWith('finance.correction.'));
    const afterFlags = auditRows.map((e) => JSON.parse(e.after as string) as { partyChanged: boolean });
    expect(afterFlags.some((a) => a.partyChanged === true)).toBe(true);
    const log = JSON.stringify(auditRows);
    for (const secret of ['Ehemann', f.wrongDonor.id, f.rightDonor.id]) expect(log).not.toContain(secret);
  });

  it('in an open year it applies at once', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalDonation({ date: '2026-03-05', cents: 5000, contactId: f.wrongDonor.id });
    const line = entry.allocationLines[0]!;
    const requested = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'Falsch zugeordnet' }));
    expect(requested).toMatchObject({ applied: true, correction: { state: 'applied' } });
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: entry.id })).allocationLines[0]!.contactId).toBe(f.rightDonor.id);
  });

  it('refuses a draft line and a correction that changes nothing', async () => {
    const f = await ledgerFixture();
    const draft = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, contactId: f.wrongDonor.id }] }));
    const line = draft.allocationLines[0]!;
    expect(err(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.wrongDonor.id }, note: 'x' }))).toMatchObject({ type: 'conflict', code: 'correctionChangesNothing' });
  });

  it('the purpose of an income line changes only with a document proving what the donor wanted — otherwise it is a reallocation', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalDonation({ date: '2026-03-05', cents: 5000, contactId: f.donor.id });
    const line = entry.allocationLines[0]!;
    const newPurpose = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Dachsanierung' }));
    expect(err(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { purposeId: newPurpose.id }, note: 'x' }))).toMatchObject({ type: 'conflict', code: 'purposeChangeNeedsProof' });

    seedLetter(f.deps, 'PROOF1');
    const withDms = ctxWith([...f.ctx.permissions, 'dms.view'], f.userId);
    const requested = unwrap(await requestAllocationCorrection(f.deps, withDms, { lineId: line.id, changes: { purposeId: newPurpose.id }, note: 'x', proofDocumentId: 'PROOF1' }));
    expect(requested.applied).toBe(true);
    const after = unwrap(await getEntry(f.deps, f.ctx, { id: entry.id }));
    expect(after.vouchers.some((v) => v.documentId === 'PROOF1')).toBe(true);
  });

  it('the purpose of an expense line needs no such proof', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -5000 }] }));
    const line = entry.allocationLines[0]!;
    const newPurpose = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Projekt X' }));
    const requested = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { purposeId: newPurpose.id }, note: 'x' }));
    expect(requested.applied).toBe(true);
  });

  it('after the tax return was filed, changing donor, purpose or the abroad switch wants the § 153 notice acknowledged', async () => {
    const f = await ledgerFixture();
    unwrap(await updateFiscalYear(f.deps, f.ctx, { id: f.year.id, taxReturnFiledOn: '2027-05-01' }));
    const entry = await f.finalDonation({ date: '2026-03-05', cents: 5000, contactId: f.wrongDonor.id });
    const line = entry.allocationLines[0]!;
    const requested = await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'x' });
    expect(err(requested)).toMatchObject({ type: 'conflict', code: 'section153Unacknowledged' });
    const ok1 = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'x', acknowledgeSection153: true }));
    expect(ok1.notices).toContain('section153');
  });

  it('changing only the project never raises the § 153 notice', async () => {
    const f = await ledgerFixture();
    unwrap(await updateFiscalYear(f.deps, f.ctx, { id: f.year.id, taxReturnFiledOn: '2027-05-01' }));
    const entry = await f.finalDonation({ date: '2026-03-05', cents: 5000, contactId: f.donor.id });
    const line = entry.allocationLines[0]!;
    const project = await seedProject(f.deps, f.userId, 'testprojekt-1');
    const requested = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { projectId: project.id }, note: 'x' }));
    expect(requested.notices).toEqual([]);
  });

  it('a lock with scope contact blocks the donor, not the project', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const entry1 = await f.finalDonation({ date: '2025-11-03', cents: 5000, contactId: f.wrongDonor.id });
    const entry2 = await f.finalDonation({ date: '2025-11-04', cents: 3000, contactId: f.wrongDonor.id });
    f.closeYear(f.years['2025']!.id);
    const line1 = entry1.allocationLines[0]!;
    const line2 = entry2.allocationLines[0]!;
    const blockingLock: EntryLock = () => ({ scope: 'contact', reason: 'Bestätigung bereits versandt.' });

    const contactCorrection = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line1.id, changes: { contactId: f.rightDonor.id }, note: 'x' }));
    const blocked = f.deps.db.transaction((tx) => applyCorrectionInternal(tx, f.deps, f.secondPerson, contactCorrection.correction.id, [blockingLock]));
    expect(blocked).toMatchObject({ ok: false, error: { type: 'conflict', code: 'contactLocked' } });

    const project = await seedProject(f.deps, f.userId, 'testprojekt-2');
    const projectCorrection = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line2.id, changes: { projectId: project.id }, note: 'y' }));
    const applied = f.deps.db.transaction((tx) => applyCorrectionInternal(tx, f.deps, f.secondPerson, projectCorrection.correction.id, [blockingLock]));
    expect(applied.ok).toBe(true);
  });

  it('one pending correction per line; a rejected one makes room', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const entry = await f.finalDonation({ date: '2025-11-03', cents: 5000, contactId: f.wrongDonor.id });
    f.closeYear(f.years['2025']!.id);
    const line = entry.allocationLines[0]!;
    const first = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'x' }));
    expect(err(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { abroad: true }, note: 'y' }))).toMatchObject({ type: 'conflict', code: 'correctionPendingExists' });
    unwrap(await rejectAllocationCorrection(f.deps, f.secondPerson, { id: first.correction.id, note: 'Doch nicht' }));
    const second = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { abroad: true }, note: 'y' }));
    expect(second.correction.state).toBe('pending');
  });

  it('approval needs finance.approve and a person; requesting needs finance.entriesFinalize and a person', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalDonation({ date: '2026-03-05', cents: 5000, contactId: f.wrongDonor.id });
    const line = entry.allocationLines[0]!;
    const writer = ctxWith(['finance.entriesWrite'], f.userId);
    expect(err(await requestAllocationCorrection(f.deps, writer, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'x' }))).toEqual({ type: 'forbidden', permission: 'finance.entriesFinalize' });
    const agent = { ...f.ctx, channel: 'mcp' as const };
    expect(err(await requestAllocationCorrection(f.deps, agent, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'x' }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    allowHumanOnlyOverMcp(f.deps);
    const requested = unwrap(await requestAllocationCorrection(f.deps, agent, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'x' }));
    expect(requested.applied).toBe(true);

    const reader = ctxWith(['finance.read'], f.userId);
    expect(err(await approveAllocationCorrection(f.deps, reader, { id: 'nope' }))).toEqual({ type: 'forbidden', permission: 'finance.approve' });
  });

  it('checks that the new contact, project and purpose exist', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalDonation({ date: '2026-03-05', cents: 5000, contactId: f.wrongDonor.id });
    const line = entry.allocationLines[0]!;
    expect(err(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: 'nope' }, note: 'x' }))).toMatchObject({ type: 'notFound', entity: 'contact' });
    expect(err(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { projectId: 'nope' }, note: 'x' }))).toMatchObject({ type: 'notFound', entity: 'project' });
    expect(err(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { purposeId: 'nope' }, note: 'x' }))).toMatchObject({ type: 'notFound', entity: 'financePurpose' });
  });

  it('lists corrections by state and by entry', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const entry = await f.finalDonation({ date: '2025-11-03', cents: 5000, contactId: f.wrongDonor.id });
    f.closeYear(f.years['2025']!.id);
    const line = entry.allocationLines[0]!;
    const requested = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'x' }));
    const listed = unwrap(await listAllocationCorrections(f.deps, f.ctx, { state: 'pending' }));
    expect(listed.items.map((c) => c.id)).toContain(requested.correction.id);
    const byEntry = unwrap(await listAllocationCorrections(f.deps, f.ctx, { entryId: entry.id }));
    expect(byEntry.total).toBe(1);
  });
});

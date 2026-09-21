import { holdsFor, schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { deleteContact } from '@kompass/module-contacts';
import { deleteDocument } from '@kompass/module-dms';
import { createProject, deleteProject } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { approveAllocationCorrection, requestAllocationCorrection } from '../src/ledger/corrections';
import { bookEntry } from '../src/ledger/finalize';
import { financeRecordDeleted, financeRecordReferences, financeRetentionDue, financeRetentionHolds, yearAnchorInternal } from '../src/ledger/holds';
import { saveDraft } from '../src/ledger/entries';
import { closeFiscalYear, reopenFiscalYear } from '../src/ledger/period';
import { setProjectFinance } from '../src/ledger/project-settings';
import { createPurpose } from '../src/ledger/purposes';
import { revokeVoucher, uploadVoucher } from '../src/ledger/vouchers';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeAllocationLines, financeEntryDocuments, financeProjectSettings } from '../src/schema';
import { allowHumanOnlyOverMcp, ledgerFixture, pdfBytes } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

/** Ein Projekt anlegen, ohne dass `f.ctx` `projects.manage` braucht (Muster corrections.test.ts). */
async function seedProject(deps: Awaited<ReturnType<typeof ledgerFixture>>['deps'], userId: string, slug: string) {
  const manager = ctxWith(['projects.manage'], userId);
  return unwrap(await createProject(deps, manager, { slug, name: { de: 'Testprojekt' }, type: 'ongoing' as const, summary: { de: '' }, body: { de: '' } }));
}

describe('what finance holds, and until when', () => {
  it('a contact on a finalized line is held for good while the year was never closed', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const entry = await f.finalDonation({ date: '2025-06-01', cents: 5000, contactId: f.donor.id });
    const holds = financeRetentionHolds(f.deps, 'contact', f.donor.id);
    expect(holds).toEqual([{ label: `Buchung ${entry.number}`, until: null, entity: 'financeEntry', id: entry.id }]);
  });

  it('once the year is closed, the hold ends ten years after the anchor — end of that calendar year', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    f.deps.clock.set('2025-06-01T10:00:00.000Z'); // vor dem Abschluss finalisiert — der Abschluss ist der spätere Vorgang.
    await f.finalDonation({ date: '2025-06-01', cents: 5000, contactId: f.donor.id });
    f.closeYear(f.years['2025']!.id); // setzt `at` auf 2025-12-31T23:59:59.000Z
    const holds = financeRetentionHolds(f.deps, 'contact', f.donor.id);
    expect(holds[0]!.until).toBe('2035-12-31');
  });

  it('the anchor is the later of closing and the latest activity: a correction applied later moves it', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    f.deps.clock.set('2025-06-01T10:00:00.000Z');
    const entry = await f.finalDonation({ date: '2025-06-01', cents: 5000, contactId: f.donor.id });
    f.closeYear(f.years['2025']!.id);
    expect(financeRetentionHolds(f.deps, 'contact', f.donor.id)[0]!.until).toBe('2035-12-31');

    f.deps.clock.set('2026-03-01T10:00:00.000Z'); // später als der Abschluss vom 31.12.2025.
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!;
    const requested = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { abroad: true }, note: 'Auslandsbezug nachgetragen' }));
    expect(requested.applied).toBe(false); // Jahr ist geschlossen — wartet auf eine zweite Person.
    unwrap(await approveAllocationCorrection(f.deps, f.secondPerson, { id: requested.correction.id }));

    const holds = financeRetentionHolds(f.deps, 'contact', f.donor.id);
    expect(holds[0]!.until).toBe('2036-12-31');
  });

  it('a reopened year holds for good again', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    f.deps.clock.set('2025-06-01T10:00:00.000Z');
    await f.finalDonation({ date: '2025-06-01', cents: 5000, contactId: f.donor.id });
    f.closeYear(f.years['2025']!.id);
    expect(financeRetentionHolds(f.deps, 'contact', f.donor.id)[0]!.until).toBe('2035-12-31');
    f.deps.clock.set('2026-01-15T09:00:00.000Z'); // nach dem Abschluss — sonst stünde das Öffnen zeitlich vor ihm.
    unwrap(await reopenFiscalYear(f.deps, f.ctx, { id: f.years['2025']!.id, note: 'Fund im Kassenbericht' }));
    expect(financeRetentionHolds(f.deps, 'contact', f.donor.id)[0]!.until).toBeNull();
  });

  it('a contact only on a draft is not held', async () => {
    const f = await ledgerFixture();
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, contactId: f.donor.id }] }));
    expect(financeRetentionHolds(f.deps, 'contact', f.donor.id)).toEqual([]);
  });

  it('a voucher is held eight years from the end of the entry’s fiscal year — also when revoked', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'Bar-Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -1500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500 }] }));
    const voucher = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-own', documentDate: '2025-06-01' }));
    expect(financeRetentionHolds(f.deps, 'document', voucher.documentId)).toEqual([{ label: `Buchung ${entry.number}`, until: '2033-12-31', entity: 'financeEntry', id: entry.id }]);

    unwrap(await revokeVoucher(f.deps, f.ctx, { linkId: voucher.linkId, note: 'Falscher Anhang' }));
    expect(financeRetentionHolds(f.deps, 'document', voucher.documentId)).toEqual([{ label: `Buchung ${entry.number}`, until: '2033-12-31', entity: 'financeEntry', id: entry.id }]);
  });

  it('a voucher on a draft is not held', async () => {
    const f = await ledgerFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] }));
    const voucher = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: draft.id, bytes: pdfBytes(), typeKey: 'voucher-own', documentDate: '2026-03-01' }));
    expect(financeRetentionHolds(f.deps, 'document', voucher.documentId)).toEqual([]);
  });

  it('a project on a finalized line is held without end', async () => {
    const f = await ledgerFixture();
    const project = await seedProject(f.deps, f.userId, 'testprojekt');
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, projectId: project.id }] }));
    expect(financeRetentionHolds(f.deps, 'project', project.id)).toEqual([{ label: `Buchung ${entry.number}`, until: null, entity: 'financeEntry', id: entry.id }]);
  });

  it('names entry numbers, never texts; one hold per entry even with three lines', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: '2026-02-01',
        text: 'Split-Spende — Kontaktname Musterspenderin',
        moneyLines: [{ accountId: f.bank.id, amountCents: 300 }],
        allocationLines: [
          { categoryId: f.donations.id, amountCents: 100, contactId: f.donor.id },
          { categoryId: f.donations.id, amountCents: 100, contactId: f.donor.id },
          { categoryId: f.donations.id, amountCents: 100, contactId: f.donor.id },
        ],
      }),
    );
    const holds = financeRetentionHolds(f.deps, 'contact', f.donor.id);
    expect(holds).toHaveLength(1);
    expect(holds[0]!.label).toBe(`Buchung ${entry.number}`);
    expect(JSON.stringify(holds)).not.toContain('Musterspenderin');
  });

  it('holdsFor of the core sees them: deleting such a contact is refused with the entry number', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalDonation({ date: '2026-02-01', cents: 5000, contactId: f.donor.id });
    const holds = holdsFor(f.deps, 'contact', f.donor.id);
    expect(holds.some((h) => h.label === `Buchung ${entry.number}`)).toBe(true);

    const manage = ctxWith(['contacts.manage'], f.userId);
    const result = await deleteContact(f.deps, manage, { id: f.donor.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { message: string }).message).toContain(`Buchung ${entry.number}`);
  });

  it('answers nothing for entity types it does not know, and never throws', async () => {
    const f = await ledgerFixture();
    expect(financeRetentionHolds(f.deps, 'animal', 'A1')).toEqual([]);
    expect(financeRetentionHolds(f.deps, 'nonsense-entity', 'X')).toEqual([]);
    expect(() => financeRetentionHolds(f.deps, 'animal', 'A1')).not.toThrow();
  });
});

describe('references and what happens when something is deleted', () => {
  it('a project is referenced by lines — also of drafts — and by purposes', async () => {
    const f = await ledgerFixture();
    const project = await seedProject(f.deps, f.userId, 'testprojekt');
    expect(financeRecordReferences(f.deps, 'project', project.id)).toEqual([]);

    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000, projectId: project.id }] }));
    expect(financeRecordReferences(f.deps, 'project', project.id)).toEqual([{ label: `Buchung ${draft.id}`, entity: 'financeEntry', id: draft.id }]);

    const project2 = await seedProject(f.deps, f.userId, 'testprojekt-2');
    unwrap(await createPurpose(f.deps, f.ctx, { name: 'Zweck mit Projekt', projectId: project2.id }));
    expect(financeRecordReferences(f.deps, 'project', project2.id)).toHaveLength(1);
    expect(financeRecordReferences(f.deps, 'project', project2.id)[0]!.entity).toBe('financePurpose');
  });

  it('a voucher is referenced while its hold runs, and no longer afterwards', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-01-15', text: 'Bar-Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -1500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500 }] }));
    const voucher = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-own', documentDate: '2026-01-15' }));
    expect(financeRecordReferences(f.deps, 'document', voucher.documentId)).toHaveLength(1);

    f.deps.clock.set('2035-06-01T00:00:00.000Z'); // 8 Jahre nach Ende des Geschäftsjahres 2026 sind um.
    expect(financeRecordReferences(f.deps, 'document', voucher.documentId)).toEqual([]);
  });

  it('contacts are never referenced, only held', async () => {
    const f = await ledgerFixture();
    await f.finalDonation({ date: '2026-02-01', cents: 5000, contactId: f.donor.id });
    expect(financeRecordReferences(f.deps, 'contact', f.donor.id)).toEqual([]);
  });

  it('the file module refuses to delete a voucher while finance holds it, and lets it go afterwards', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-01-15', text: 'Bar-Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -1500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500 }] }));
    // Die Dokumentart selbst wäre 2026 längst verjährt (documentDate 2010) — was blockiert, ist der Halter der Finanzen.
    const voucher = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-own', documentDate: '2010-01-15' }));
    const manage = ctxWith([...FINANCE_PERMISSIONS, 'dms.manage'], f.userId);

    const refused = await deleteDocument(f.deps, manage, { id: voucher.documentId });
    expect(refused).toMatchObject({ ok: false, error: { type: 'conflict', code: 'recordHeld' } });

    f.deps.clock.set('2035-06-01T00:00:00.000Z');
    const allowed = await deleteDocument(f.deps, manage, { id: voucher.documentId });
    expect(allowed.ok).toBe(true);
  });

  it('when the file module deletes a voucher, the link keeps its gravestone: number and checksum, no document id', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-01-15', text: 'Bar-Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -1500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1500 }] }));
    const voucher = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-own', documentDate: '2010-01-15' }));
    const before = f.deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.id, voucher.linkId)).get()!;

    f.deps.clock.set('2035-06-01T00:00:00.000Z');
    const manage = ctxWith([...FINANCE_PERMISSIONS, 'dms.manage'], f.userId);
    unwrap(await deleteDocument(f.deps, manage, { id: voucher.documentId }));

    const after = f.deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.id, voucher.linkId)).get()!;
    expect(after.documentId).toBeNull();
    expect(after.documentDeletedAt).not.toBeNull();
    expect(after.documentNumber).toBe(before.documentNumber);
    expect(after.documentChecksum).toBe(before.documentChecksum);

    const log = f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.entry.documentGone');
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0]!.after!)).toEqual({ entryId: entry.id, linkCount: 1 });
  });

  it('never throws on unknown entity types', async () => {
    const f = await ledgerFixture();
    expect(financeRecordReferences(f.deps, 'bogus-entity', 'X')).toEqual([]);
    expect(() => f.deps.db.transaction((tx) => financeRecordDeleted(tx, f.deps, f.ctx, 'bogus-entity', 'X'))).not.toThrow();
  });

  it('when a project without entries is deleted, its finance settings go with it', async () => {
    const f = await ledgerFixture();
    const project = await seedProject(f.deps, f.userId, 'projekt-ohne-buchung');
    unwrap(await setProjectFinance(f.deps, f.ctx, { projectId: project.id, targetCents: 5000 }));
    expect(f.deps.db.select().from(financeProjectSettings).where(eq(financeProjectSettings.projectId, project.id)).all()).toHaveLength(1);

    const manage = ctxWith(['projects.manage'], f.userId);
    unwrap(await deleteProject(f.deps, manage, { id: project.id }));
    expect(f.deps.db.select().from(financeProjectSettings).where(eq(financeProjectSettings.projectId, project.id)).all()).toEqual([]);
  });
});

describe('retention due — personal data of a closed year', () => {
  it('reports a closed year as due ten years after its anchor — one item per year, no link yet', async () => {
    const f = await ledgerFixture({ years: ['2010'] });
    f.deps.clock.set('2010-06-01T10:00:00.000Z');
    await f.finalDonation({ date: '2010-06-01', cents: 5000, contactId: f.donor.id });
    f.closeYear(f.years['2010']!.id); // at = 2010-12-31T23:59:59.000Z
    f.deps.clock.set('2026-09-05T08:00:00.000Z');
    const due = financeRetentionDue(f.deps);
    expect(due).toEqual([{ entity: 'financeYearPersonalData', id: f.years['2010']!.id, label: `Finanzen ${f.years['2010']!.designation}: personenbezogene Inhalte`, dueSince: '2020-12-31' }]);
    expect(due[0]).not.toHaveProperty('href');
  });

  it('reports nothing for an open or reopened year', async () => {
    const f = await ledgerFixture({ years: ['2010'] });
    expect(financeRetentionDue(f.deps)).toEqual([]);
    f.closeYear(f.years['2010']!.id);
    unwrap(await reopenFiscalYear(f.deps, f.ctx, { id: f.years['2010']!.id, note: 'x' }));
    expect(financeRetentionDue(f.deps)).toEqual([]);
  });
});

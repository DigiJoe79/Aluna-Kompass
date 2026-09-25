import { newId } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { financeAllocationLines, financeConfirmationLines, financeConfirmations, financeInKindDetails, financeNotices, financeSigners } from '../src/schema';
import { ledgerFixture } from './helpers';

/**
 * Der mechanische Wächter der Spenden-Tabellen (F6a Task 1): jede Regel aus
 * dem Plan gegen die echte Datenbank, roh über Drizzle — Muster
 * `import-schema.test.ts`.
 */
async function fixtures() {
  const f = await ledgerFixture();
  const entry = await f.finalDonation({ date: '2026-03-01', cents: 5000, contactId: f.donor.id });
  const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entry.id)).get()!;
  return { ...f, entry, lineId: line.id };
}
type F = Awaited<ReturnType<typeof fixtures>>;

function insertNotice(f: F, o: Partial<typeof financeNotices.$inferInsert> = {}) {
  const id = o.id ?? newId();
  f.deps.db
    .insert(financeNotices)
    .values({
      id, kind: 'exemptionNotice', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', noticeDate: '2025-05-02', assessmentPeriod: '2023', purposesText: 'Förderung des Tierschutzes',
      createdAt: '2026-01-01T00:00:00.000Z', createdByUserId: 'U1', updatedAt: '2026-01-01T00:00:00.000Z', ...o,
    })
    .run();
  return id;
}

function insertSigner(f: F, o: Partial<typeof financeSigners.$inferInsert> = {}) {
  const id = o.id ?? newId();
  f.deps.db.insert(financeSigners).values({ id, validFrom: '2026-01-01', signerName: 'Jonas Feld', createdAt: '2026-01-01T00:00:00.000Z', createdByUserId: 'U1', updatedAt: '2026-01-01T00:00:00.000Z', ...o }).run();
  return id;
}

function insertConfirmation(f: F, noticeId: string, o: Partial<typeof financeConfirmations.$inferInsert> = {}) {
  const id = o.id ?? newId();
  f.deps.db
    .insert(financeConfirmations)
    .values({
      id, kind: 'money', contactId: f.donor.id, noticeId, documentId: `DOC-${id}`, documentNumber: `ZWB-2026-${id.slice(-4)}`, issuedOn: '2026-03-10', issuedByUserId: 'U1', issuedChannel: 'ui',
      machine: false, expenseWaiver: false, totalCents: 5000, createdAt: '2026-03-10T10:00:00.000Z', ...o,
    })
    .run();
  return id;
}

function insertConfirmationLine(f: F, confirmationId: string, lineId: string) {
  const id = newId();
  f.deps.db.insert(financeConfirmationLines).values({ id, confirmationId, lineId, amountCents: 5000 }).run();
  return id;
}

describe('finance_notices', () => {
  it('is never deleted', async () => {
    const f = await fixtures();
    const id = insertNotice(f);
    expect(() => f.deps.db.delete(financeNotices).where(eq(financeNotices.id, id)).run()).toThrow(/permanent/);
  });

  it('is superseded once: date and document go from empty to a value, and stay', async () => {
    const f = await fixtures();
    const id = insertNotice(f);
    // Solange nicht ersetzt, bleibt der Bescheid änderbar (Dienst prüft den Rest).
    f.deps.db.update(financeNotices).set({ taxNumber: '99/999/99998' }).where(eq(financeNotices.id, id)).run();
    f.deps.db.update(financeNotices).set({ supersededOn: '2026-06-01', supersededDocumentId: 'DOC-S' }).where(eq(financeNotices.id, id)).run();
    expect(() => f.deps.db.update(financeNotices).set({ supersededOn: '2026-07-01' }).where(eq(financeNotices.id, id)).run()).toThrow(/permanent/);
    expect(() => f.deps.db.update(financeNotices).set({ supersededDocumentId: 'DOC-X' }).where(eq(financeNotices.id, id)).run()).toThrow(/permanent/);
  });

  it('is voided once', async () => {
    const f = await fixtures();
    const id = insertNotice(f);
    f.deps.db.update(financeNotices).set({ voidedAt: '2026-06-01T00:00:00.000Z', voidedByUserId: 'U1', voidNote: 'Tippfehler' }).where(eq(financeNotices.id, id)).run();
    expect(() => f.deps.db.update(financeNotices).set({ voidNote: 'anders' }).where(eq(financeNotices.id, id)).run()).toThrow(/permanent/);
    expect(() => f.deps.db.update(financeNotices).set({ voidedAt: null }).where(eq(financeNotices.id, id)).run()).toThrow(/permanent/);
  });
});

describe('finance_signers', () => {
  it('is never deleted, but its fields stay changeable (end of term, facsimile, notification)', async () => {
    const f = await fixtures();
    const id = insertSigner(f);
    f.deps.db.update(financeSigners).set({ validTo: '2026-12-31', facsimileKey: 'signature-x.png', facsimileChecksum: 'abc', notifiedOn: '2026-02-01' }).where(eq(financeSigners.id, id)).run();
    expect(() => f.deps.db.delete(financeSigners).where(eq(financeSigners.id, id)).run()).toThrow(/permanent/);
  });
});

describe('finance_confirmations', () => {
  it('is never deleted, and what was issued never changes', async () => {
    const f = await fixtures();
    const noticeId = insertNotice(f);
    const id = insertConfirmation(f, noticeId);
    expect(() => f.deps.db.delete(financeConfirmations).where(eq(financeConfirmations.id, id)).run()).toThrow(/permanent/);
    for (const change of [{ totalCents: 1 }, { contactId: 'OTHER' }, { issuedOn: '2026-03-11' }, { documentNumber: 'ZWB-X' }, { noticeId: 'OTHER' }, { machine: true }, { preNoticeReason: 'nachträglich' }, { kind: 'inKind' as const }]) {
      expect(() => f.deps.db.update(financeConfirmations).set(change).where(eq(financeConfirmations.id, id)).run(), JSON.stringify(change)).toThrow(/permanent/);
    }
  });

  it('takes dispatch, the signed version once, and the voiding once', async () => {
    const f = await fixtures();
    const noticeId = insertNotice(f);
    const id = insertConfirmation(f, noticeId);
    f.deps.db.update(financeConfirmations).set({ sentAt: '2026-03-11', sentVia: 'post' }).where(eq(financeConfirmations.id, id)).run();
    f.deps.db.update(financeConfirmations).set({ signedDocumentId: 'DOC-SIGNED' }).where(eq(financeConfirmations.id, id)).run();
    expect(() => f.deps.db.update(financeConfirmations).set({ signedDocumentId: 'DOC-OTHER' }).where(eq(financeConfirmations.id, id)).run()).toThrow(/permanent/);
    f.deps.db
      .update(financeConfirmations)
      .set({ voidedAt: '2026-04-01T00:00:00.000Z', voidedByUserId: 'U1', voidNote: 'Betrag falsch', sentBeforeVoid: true, originalReturnedOn: '2026-04-05', taxOfficeInformedOn: '2026-04-06' })
      .where(eq(financeConfirmations.id, id))
      .run();
    expect(() => f.deps.db.update(financeConfirmations).set({ voidNote: 'anders' }).where(eq(financeConfirmations.id, id)).run()).toThrow(/permanent/);
  });

  it('has no foreign key to contacts or documents, but one to its notice', async () => {
    const f = await fixtures();
    // Kontakt- und Dokument-IDs sind frei (keine Tabelle dahinter nötig) — der Bescheid nicht.
    expect(() => insertConfirmation(f, 'NO-SUCH-NOTICE')).toThrow(/FOREIGN KEY/);
    const noticeId = insertNotice(f);
    insertConfirmation(f, noticeId, { contactId: 'ANY-CONTACT', documentId: 'ANY-DOCUMENT' });
  });
});

describe('finance_confirmation_lines', () => {
  it('holds a line in one valid confirmation only; once released, the line can be confirmed again', async () => {
    const f = await fixtures();
    const noticeId = insertNotice(f);
    const first = insertConfirmation(f, noticeId);
    const lineRow = insertConfirmationLine(f, first, f.lineId);
    const second = insertConfirmation(f, noticeId);
    expect(() => insertConfirmationLine(f, second, f.lineId)).toThrow(/UNIQUE/);

    f.deps.db.update(financeConfirmationLines).set({ releasedAt: '2026-04-01T00:00:00.000Z' }).where(eq(financeConfirmationLines.id, lineRow)).run();
    insertConfirmationLine(f, second, f.lineId);
  });

  it('is never deleted; only released_at changes, from empty to a value, once', async () => {
    const f = await fixtures();
    const noticeId = insertNotice(f);
    const confirmationId = insertConfirmation(f, noticeId);
    const id = insertConfirmationLine(f, confirmationId, f.lineId);
    expect(() => f.deps.db.delete(financeConfirmationLines).where(eq(financeConfirmationLines.id, id)).run()).toThrow(/permanent/);
    expect(() => f.deps.db.update(financeConfirmationLines).set({ amountCents: 1 }).where(eq(financeConfirmationLines.id, id)).run()).toThrow(/permanent/);
    f.deps.db.update(financeConfirmationLines).set({ releasedAt: '2026-04-01T00:00:00.000Z' }).where(eq(financeConfirmationLines.id, id)).run();
    expect(() => f.deps.db.update(financeConfirmationLines).set({ releasedAt: '2026-04-02T00:00:00.000Z' }).where(eq(financeConfirmationLines.id, id)).run()).toThrow(/permanent/);
  });

  it('points at an existing allocation line', async () => {
    const f = await fixtures();
    const noticeId = insertNotice(f);
    const confirmationId = insertConfirmation(f, noticeId);
    expect(() => insertConfirmationLine(f, confirmationId, 'NO-SUCH-LINE')).toThrow(/FOREIGN KEY/);
  });
});

describe('finance_in_kind_details', () => {
  it('belongs to one allocation line, keyed by it', async () => {
    const f = await fixtures();
    const row = { lineId: f.lineId, item: 'Kratzbaum', condition: 'gebraucht, zwei Jahre', valuation: 'Vergleichsangebot', origin: 'private' as const, createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' };
    f.deps.db.insert(financeInKindDetails).values(row).run();
    expect(() => f.deps.db.insert(financeInKindDetails).values(row).run()).toThrow(/UNIQUE|PRIMARY/);
    expect(() => f.deps.db.insert(financeInKindDetails).values({ ...row, lineId: 'NO-SUCH-LINE' }).run()).toThrow(/FOREIGN KEY/);
  });
});

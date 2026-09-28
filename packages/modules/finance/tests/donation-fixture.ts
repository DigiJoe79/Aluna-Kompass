import { unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { saveSigner, uploadFacsimile } from '../src/donations/machine';
import { saveNotice } from '../src/donations/notices';
import { bookEntry } from '../src/ledger/finalize';
import { writeVoucherLink } from '../src/ledger/vouchers';
import { financeCategories, financeMoneyLines, type FinanceCategoryRow } from '../src/schema';
import { insertDocument, ledgerFixture } from './helpers';

/**
 * Ausgangslage der Spenden-Tests (F6a Task 5): Vereinsanschrift, ein
 * Freistellungsbescheid vom 2025-05-02 mit Steuerbefreiung ab 2025-04-01
 * (eine Zuwendung vom 2025-03-01 liegt davor), eine vollständige Spenderin (erfunden)
 * und Helfer, die festgeschriebene, belegte Zuwendungen buchen. Heute ist der
 * 2026-03-20.
 */
export const EXEMPTION = { kind: 'exemptionNotice', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', noticeDate: '2025-05-02', exemptFrom: '2025-04-01', assessmentPeriod: '2023', purposesText: 'Förderung des Tierschutzes' } as const;

/** Ein PNG-Kopf (Magic Bytes) — die Dienste prüfen den Anfang, nicht das Bild. */
export const png = (size = 64) => {
  const b = new Uint8Array(size).fill(1);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return b;
};

export async function donationFixture(opts: { notice?: boolean; machine?: boolean; years?: readonly string[] } = {}) {
  const f = await ledgerFixture({ years: opts.years ?? ['2025', '2026'] });
  f.deps.clock.set('2026-03-20T10:00:00.000Z');
  const system = systemContext();
  f.deps.db.transaction((tx) => {
    for (const [key, value] of [['organization.name', 'Musterverein e.V.'], ['organization.street', 'Musterweg 1'], ['organization.postalCode', '12345'], ['organization.city', 'Musterstadt']] as const) {
      writeSettingInternal(tx, f.deps, system, key, value, 'test.organization');
    }
    // Spec E13: Aufwandsspenden sind ein Schalter mit Vorgabe aus — dieser Verein bietet sie an.
    writeSettingInternal(tx, f.deps, system, 'finance.expenseWaiversEnabled', true, 'test.organization');
  });

  const manage: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  const erika = unwrap(await createContact(f.deps, manage, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel', street: 'Beispielstraße 7', postalCode: '54321', city: 'Beispielstadt' }));
  const notice = opts.notice === false ? null : unwrap(await saveNotice(f.deps, f.ctx, EXEMPTION));

  let signerId: string | null = null;
  if (opts.machine) {
    const signer = unwrap(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: 'Jonas Feld', notifiedOn: '2026-02-01' }));
    unwrap(await uploadFacsimile(f.deps, f.ctx, { signerId: signer.id, bytes: png(), mimeType: 'image/png' }));
    signerId = signer.id;
  }

  const categoryByKey = (key: string): FinanceCategoryRow => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;

  /** Ein Beleg an der Buchung — direkt über den internen Weg, ohne Rechte der Akte. */
  const attachVoucher = (entryId: string) => {
    const documentId = insertDocument(f, { subject: 'Beleg', linkedEntryId: entryId });
    f.deps.db.transaction((tx) => writeVoucherLink(tx, f.deps, f.ctx, { entryId, documentId, documentNumber: 'DOC', documentChecksum: 'abc', viaUpload: false }));
    return documentId;
  };

  /**
   * Eine festgeschriebene Geldzuwendung. Belegt über den Kontoumsatz (die
   * Kategorien des Startplans tragen „Auszug genügt“), außer `documented: false`.
   */
  const donate = async (o: { date?: string; cents?: number; contactId?: string | null; categoryKey?: string; documented?: boolean; originLineId?: string } = {}) => {
    const cents = o.cents ?? 5000;
    const entry = unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: o.date ?? '2026-03-05',
        text: 'Zuwendung',
        moneyLines: [{ accountId: f.bank.id, amountCents: cents }],
        allocationLines: [{ categoryId: categoryByKey(o.categoryKey ?? 'donations').id, amountCents: cents, contactId: o.contactId === undefined ? erika.id : o.contactId, originLineId: o.originLineId ?? null }],
      }),
    );
    if (o.documented !== false) f.deps.db.update(financeMoneyLines).set({ rawTransactionId: `R-${entry.id}` }).where(eq(financeMoneyLines.entryId, entry.id)).run();
    return { entry, line: entry.allocationLines[0]! };
  };

  /** Eine Rückbuchung auf eine Zeile (Rücklastschrift, Rückzahlung): negativ, mit `originLineId`. */
  const giveBack = async (lineId: string, cents: number, date = '2026-03-10') => donate({ date, cents: -cents, originLineId: lineId });

  /** Eine Aufwandsspende: kein Geldfluss, +Wert Aufwandsspende / −Wert Reisekosten, belegt über einen Beleg. */
  const waive = async (o: { date?: string; cents?: number } = {}) => {
    const cents = o.cents ?? 4200;
    const entry = unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: o.date ?? '2026-03-06',
        text: 'Verzicht auf Fahrtkostenerstattung',
        moneyLines: [],
        allocationLines: [
          { categoryId: categoryByKey('expense-waivers').id, amountCents: cents, contactId: erika.id },
          { categoryId: categoryByKey('travel').id, amountCents: -cents },
        ],
      }),
    );
    attachVoucher(entry.id);
    return { entry, line: entry.allocationLines.find((l) => l.amountCents > 0)! };
  };

  /** Eine Sachspende ohne Geldfluss (Spec 5.2, Prüfstein 5): +Wert Sachspende / −Wert Sachaufwand. Noch ohne Beleg. */
  const giveInKind = async (o: { date?: string; cents?: number; contactId?: string } = {}) => {
    const cents = o.cents ?? 25000;
    const entry = unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: o.date ?? '2026-03-07',
        text: 'Sachspende',
        moneyLines: [],
        allocationLines: [
          { categoryId: categoryByKey('in-kind-donations').id, amountCents: cents, contactId: o.contactId ?? erika.id },
          { categoryId: categoryByKey('program-in-kind').id, amountCents: -cents },
        ],
      }),
    );
    return { entry, line: entry.allocationLines.find((l) => l.amountCents > 0)! };
  };

  return { ...f, manage, erika, notice, signerId, categoryByKey, attachVoucher, donate, giveBack, waive, giveInKind };
}

export type DonationFixture = Awaited<ReturnType<typeof donationFixture>>;

export const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

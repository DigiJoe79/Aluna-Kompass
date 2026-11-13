import { defineModule, unwrap, type CallContext } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { bookEntry } from '../src/ledger/finalize';
import { createOpenItem, createOriginOpenItem } from '../src/ledger/open-items';
import { financeCategories, financeMoneyLines } from '../src/schema';
import { insertRaw, insertRun, ledgerFixture } from './helpers';

/**
 * Spec Zahlung zuordnen: ein Testmodul, das die Herkunft `memberFeeCharge` anmeldet und als Haken `payerContacts`
 * für die Herkunft `MINOR` die Erziehungsberechtigte bis zum Tag `guardianUntil` (ausschließlich) meldet — wie die
 * Mitglieder mit dem 18. Geburtstag.
 */
export const guardianState: { guardianId: string | null; guardianUntil: string } = { guardianId: null, guardianUntil: '2026-07-01' };
export const membersStub = defineModule({
  key: 'members',
  version: '0',
  permissions: [],
  dependsOn: ['finance'],
  openItemOrigins: [{ type: 'memberFeeCharge', payerContacts: (_deps, _db, input) => (input.originId === 'MINOR' && guardianState.guardianId && input.paymentDate < guardianState.guardianUntil ? [guardianState.guardianId] : []) }],
});

export async function assignFixture() {
  const f = await ledgerFixture({ years: ['2025', '2026'], extraModules: [membersStub] });
  const contactsCtx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  const member = f.donor;
  const guardian = unwrap(await createContact(f.deps, contactsCtx, { kind: 'person', lastName: 'Erziehungsberechtigte' }));
  guardianState.guardianId = guardian.id;
  const category = (key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;
  const feeCategory = category('membership-fees');
  const runId = insertRun(f, f.bank.id, { periodFrom: '2025-01-01' });

  /** Ein Beitrag als Posten mit Herkunft, Vorlage in der Beitragskategorie. */
  const feeItem = (o: { contactId?: string; amountCents?: number; itemDate?: string; originId?: string; paymentReference?: string } = {}) => {
    const contactId = o.contactId ?? member.id;
    return unwrap(
      f.deps.db.transaction((tx) =>
        createOriginOpenItem(tx, f.deps, f.ctx, {
          originType: 'memberFeeCharge', originId: o.originId ?? `FEE-${Math.random()}`, contactId, amountCents: o.amountCents ?? 6000, itemDate: o.itemDate ?? '2026-03-01', dueOn: '2026-03-31',
          paymentReference: o.paymentReference ?? 'MB-0007-2026', lineTemplate: [{ categoryId: feeCategory.id, contactId }],
        }),
      ),
    );
  };
  /** Ein Posten ohne Vorlage. */
  const plainItem = async (o: { contactId?: string; amountCents?: number; itemDate?: string } = {}) =>
    unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: o.itemDate ?? '2026-03-01', amountCents: o.amountCents ?? 6000, contactId: o.contactId ?? member.id }));

  /** Eine festgeschriebene Einnahme; `purpose` legt einen Bankumsatz mit Verwendungszweck an. Liefert Buchung und Geldzeile. */
  const pay = async (o: { cents: number; date: string; contactId?: string; categoryKey?: string; purpose?: string; settlements?: { openItemId: string; amountCents: number }[] }) => {
    const rawTransactionId = o.purpose ? insertRaw(f, runId, { accountId: f.bank.id, amountCents: o.cents, purpose: o.purpose, date: o.date }) : undefined;
    const entry = unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: o.date, text: 'Zahlung',
        moneyLines: [{ accountId: f.bank.id, amountCents: o.cents, ...(rawTransactionId ? { rawTransactionId } : {}), ...(o.settlements ? { settlements: o.settlements } : {}) }],
        allocationLines: [{ categoryId: category(o.categoryKey ?? 'membership-fees').id, amountCents: o.cents, contactId: o.contactId ?? member.id }],
        acknowledgedWarnings: ['overpaid'],
      }),
    );
    const line = f.deps.db.select().from(financeMoneyLines).where(eq(financeMoneyLines.entryId, entry.id)).get()!;
    return { entry, lineId: line.id };
  };
  return { ...f, member, guardian, feeCategory, category, feeItem, plainItem, pay };
}

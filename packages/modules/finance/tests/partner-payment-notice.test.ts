import { unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry, finalizeEntry } from '../src/ledger/finalize';
import { createOpenItem } from '../src/ledger/open-items';
import { financeCategories, financeOpenItems } from '../src/schema';
import { ledgerFixture } from './helpers';
import { insertPartner, insertPartnerPaidLine, insertPartnerPayment } from './partner-fixture';

type F = Awaited<ReturnType<typeof ledgerFixture>>;
const grantOf = (f: F) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'partner-transfers')).get()!;
const expense = (f: F, categoryId: string, cents = -25000, extra: Record<string, unknown> = {}) => ({
  entryDate: '2026-05-04',
  text: 'Förderung',
  moneyLines: [{ accountId: f.bank.id, amountCents: cents, ...extra }],
  allocationLines: [{ categoryId, amountCents: cents }],
});

/**
 * N20 (Nachttest 0.4.0, Joe 2026-10-27): Mittel an Partner brauchen den Nachweis der Verwendung (§ 58 Nr. 1 AO); den
 * verfolgt Kompass nur an einer Zahlung an Partner. Eine Buchung auf eine Kategorie der Mittelweitergabe ohne sie geht
 * durch und trägt einen Hinweis — keine Sperre.
 */
describe('notice for grants to partners booked without a partner payment', () => {
  it('notes a grant line without a partner payment, nothing on other categories or refunds', async () => {
    const f = await ledgerFixture();
    const grant = grantOf(f);
    const booked = unwrap(await bookEntry(f.deps, f.ctx, expense(f, grant.id)));
    expect(booked.status).toBe('final');
    expect(booked.notices).toContain('partnerPaymentMissing');
    expect(unwrap(await bookEntry(f.deps, f.ctx, expense(f, f.programCosts.id))).notices).not.toContain('partnerPaymentMissing');
    // Eine Rückzahlung des Partners ist kein Mittelabfluss.
    expect(unwrap(await bookEntry(f.deps, f.ctx, expense(f, grant.id, 5000))).notices).not.toContain('partnerPaymentMissing');
  });

  it('notes nothing when the entry settles a partner payment or its line is paid by one', async () => {
    const f = await ledgerFixture();
    const grant = grantOf(f);
    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-05-01', amountCents: 25000 }));
    f.deps.db.update(financeOpenItems).set({ originType: 'financePartnerPayment', originId: 'PZ1' }).where(eq(financeOpenItems.id, item.id)).run();
    const settled = unwrap(await bookEntry(f.deps, f.ctx, expense(f, grant.id, -25000, { settlements: [{ openItemId: item.id, amountCents: 25000 }] })));
    expect(settled.notices).not.toContain('partnerPaymentMissing');

    // „Als Zahlung an Partner erfassen“: der Entwurf trägt schon die bezahlte Zeile einer nachträglichen Zahlung.
    const partnerContact = unwrap(await createContact(f.deps, { ...systemContext(), permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Hilfswerk Test' }));
    const payment = insertPartnerPayment(f.deps.db, insertPartner(f.deps.db, { contactId: partnerContact.id }), { retroactive: true });
    const draft = unwrap(await saveDraft(f.deps, f.ctx, expense(f, grant.id)));
    insertPartnerPaidLine(f.deps.db, payment, draft.allocationLines[0]!.id);
    expect(unwrap(await finalizeEntry(f.deps, f.ctx, { id: draft.id })).notices).not.toContain('partnerPaymentMissing');
  });
});

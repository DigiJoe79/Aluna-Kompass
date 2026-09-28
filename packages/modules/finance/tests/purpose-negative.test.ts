import { unwrap } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getPartnerPayment, savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { savePartnerProfile } from '../src/allocation/partners';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry, finalizeEntry } from '../src/ledger/finalize';
import { purposeBalancesAt } from '../src/ledger/queries';
import { financeEntries, financePartnerPayments } from '../src/schema';
import { ledgerFixture } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

/**
 * Block 2, Befund Q (Design-Nachtrag Phase 4, Teil C Task 2c): Ein Zweck ging
 * ohne Warnung ins Minus (−100 €). Wer festschreibt oder eine Zahlung an
 * Partner einreicht, die den Bestand eines Zwecks negativ machte, gibt eine
 * Begründung an (Muster AH) — kein Verbot.
 */
async function fixture() {
  const f = await ledgerFixture();
  // 200 € zweckgebunden eingegangen.
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Zweckspende', moneyLines: [{ accountId: f.bank.id, amountCents: 20000 }], allocationLines: [{ categoryId: f.purposeIncome.id, amountCents: 20000, purposeId: f.abroadPurpose.id }] }));
  return f;
}
type F = Awaited<ReturnType<typeof fixture>>;
const spend = (f: F, cents: number, reason?: string) => ({ entryDate: '2026-03-10', text: 'Ausgabe für den Zweck', moneyLines: [{ accountId: f.bank.id, amountCents: -cents }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -cents, purposeId: f.abroadPurpose.id }], ...(reason ? { reason } : {}) });
const balance = (f: F) => purposeBalancesAt(f.deps.db, '2026-12-31').find((b) => b.purposeId === f.abroadPurpose.id)!.balanceCents;

describe('Befund Q: Zweck ins Minus beim Festschreiben', () => {
  it('bookEntry verlangt eine Begründung, wenn der Zweck dadurch negativ würde, und speichert sie an der Buchung', async () => {
    const f = await fixture();
    expect(err(await bookEntry(f.deps, f.ctx, spend(f, 30000)))).toMatchObject({ code: 'purposeGoesNegative', params: { purpose: 'Partnerprojekt Ausland', balance: -10000 } });
    expect(balance(f)).toBe(20000);
    const booked = unwrap(await bookEntry(f.deps, f.ctx, spend(f, 30000, 'Vorschuss, Spenden sind zugesagt')));
    expect(booked.purposeNegativeReason).toBe('Vorschuss, Spenden sind zugesagt');
    expect(balance(f)).toBe(-10000);
  });

  it('bleibt der Zweck im Plus, braucht es keine Begründung — und keine wird gespeichert', async () => {
    const f = await fixture();
    const booked = unwrap(await bookEntry(f.deps, f.ctx, spend(f, 15000, 'unnötig')));
    expect(booked.purposeNegativeReason).toBeNull();
  });

  it('ein Entwurf wird ohne Begründung nicht festgeschrieben; mit der am Entwurf gespeicherten schon', async () => {
    const f = await fixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, spend(f, 30000)));
    expect(err(await finalizeEntry(f.deps, f.ctx, { id: draft.id }))).toMatchObject({ code: 'purposeGoesNegative' });
    const withReason = unwrap(await saveDraft(f.deps, f.ctx, { ...spend(f, 30000, 'Vorschuss'), id: draft.id, expectedVersion: draft.updatedAt }));
    expect(withReason.purposeNegativeReason).toBe('Vorschuss');
    expect(unwrap(await finalizeEntry(f.deps, f.ctx, { id: draft.id })).status).toBe('final');
    expect(f.deps.db.select().from(financeEntries).where(eq(financeEntries.id, draft.id)).get()!.purposeNegativeReason).toBe('Vorschuss');
  });
});

describe('Befund Q: Zweck ins Minus beim Einreichen einer Zahlung an Partner', () => {
  it('fragt vorab (reasonsNeeded.purpose), verweigert ohne Begründung und speichert sie beim Einreichen', async () => {
    const f = await fixture();
    const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Empfängerverein e.V.' }));
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' }));
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'Futter', retroactive: false, positions: [{ kind: 'money', amountCents: 30000, categoryId: f.programCosts.id, purposeId: f.abroadPurpose.id }] }));
    expect(draft.reasonsNeeded).toMatchObject({ purpose: true });
    expect(err(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }))).toMatchObject({ code: 'purposeGoesNegative', params: { purpose: 'Partnerprojekt Ausland', balance: -10000 } });
    const submitted = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version, purposeReason: 'Vorschuss, Spenden sind zugesagt' }));
    expect(submitted.state).toBe('submitted');
    expect(f.deps.db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, draft.id)).get()!.purposeNegativeReason).toBe('Vorschuss, Spenden sind zugesagt');
    expect(unwrap(await getPartnerPayment(f.deps, f.ctx, { id: draft.id })).reasonsNeeded).toMatchObject({ purpose: false });
  });
});

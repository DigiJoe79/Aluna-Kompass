import { unwrap } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { listEligibleLines, savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { savePartnerProfile } from '../src/allocation/partners';
import { saveDraft } from '../src/ledger/entries';
import { finalizeEntry } from '../src/ledger/finalize';
import { financeAllocationLines } from '../src/schema';
import { ledgerFixture } from './helpers';

async function fixture() {
  const f = await ledgerFixture();
  const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Arbeitslistenpartner e.V.' }));
  const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' }));
  const lines = (amount: number) => ({ entryDate: '2026-03-01', text: 'Förderung aus der Arbeitsliste', moneyLines: [{ accountId: f.bank.id, amountCents: -amount }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -amount, contactId: org.id }] });
  const entry = unwrap(await saveDraft(f.deps, f.ctx, lines(4000)));
  const lineOf = (entryId: string) => f.deps.db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).get()!.id;
  return { ...f, org, partner, entry, lines, lineOf };
}

describe('Arbeitsliste „Als Zahlung an Partner erfassen“ (Design-Nachtrag Phase 4, Task 5)', () => {
  it('nimmt im Entwurf eine noch nicht festgeschriebene, ausgehende Zeile an den Partner als bezahlte Zeile; einreichen geht erst nach dem Festschreiben', async () => {
    const f = await fixture();
    const line = f.lineOf(f.entry.id);
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: true, positions: [], paidLineIds: [line] }));
    expect(draft.paidLines.map((l) => l.paidLineId)).toEqual([line]);
    expect(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version })).toMatchObject({ ok: false, error: { code: 'paidLineNotFinal' } });
    unwrap(await finalizeEntry(f.deps, f.ctx, { id: f.entry.id }));
    const again = unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    expect(again.state).toBe('submitted');
  });

  it('die eigene, noch nicht festgeschriebene Zeile bleibt in der Kandidatenliste des Entwurfs sichtbar — fremde Entwürfe nicht', async () => {
    const f = await fixture();
    const line = f.lineOf(f.entry.id);
    const before = unwrap(await listEligibleLines(f.deps, f.ctx, { partnerId: f.partner.id, kind: 'paidLine' }));
    expect(before.map((l) => l.id)).not.toContain(line);
  });

  it('der Buchungsentwurf lässt sich weiter bearbeiten — die bezahlte Zeile wandert auf die neu geschriebene Zeile an derselben Stelle', async () => {
    const f = await fixture();
    const line = f.lineOf(f.entry.id);
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: f.partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: true, positions: [], paidLineIds: [line] }));
    const saved = unwrap(await saveDraft(f.deps, f.ctx, { ...f.lines(4000), id: f.entry.id, expectedVersion: f.entry.updatedAt, text: 'Förderung, Text geändert' }));
    const newLine = f.lineOf(saved.id);
    expect(newLine).not.toBe(line);
    const read = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version, partnerId: f.partner.id, basis: 'transfer58', purposeText: 'Förderung', retroactive: true, positions: [], paidLineIds: [newLine] }));
    expect(read.paidLines.map((l) => l.paidLineId)).toEqual([newLine]);
  });
});

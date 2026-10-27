import { unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { saveContactTaxDetails } from '../src/allocation/contact-tax-details';
import { correctionTaxCodesInternal, requestAllocationCorrection } from '../src/ledger/corrections';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry, finalizeEntry, finalizeReviewed } from '../src/ledger/finalize';
import { setReviewed } from '../src/ledger/entries';
import { createOpenItem } from '../src/ledger/open-items';
import { saveVatSettings } from '../src/ledger/vat-settings';
import { ledgerFixture } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

const refusedCode = (result: { ok: boolean; error?: unknown }) => (result.ok ? null : (result.error as { type: string; issues?: { path: string; message: string }[] }));

const expense = (f: Fixture, taxCode: string, extra: Record<string, unknown> = {}) => ({
  entryDate: '2026-05-04',
  text: 'Einkauf',
  moneyLines: [{ accountId: f.bank.id, amountCents: -11900 }],
  allocationLines: [{ categoryId: f.programCosts.id, amountCents: -11900, taxCode, ...extra }],
});

/**
 * Befund 39, Frage 4 (Plan E14 Task 3): Buchen, Entwurf und Korrektur lehnen ein Kennzeichen ab, das die Auswahl des
 * Buchungstags nicht anbietet — der Verein der Fixture ist kein Unternehmer und hat keine USt-IdNr. (nur `rc13bOther`,
 * `icAcquisition`). Erlaubt bleiben Bestand und Vorgabe.
 */
describe('tax codes outside the offered choice', () => {
  it('refuses them when booking and saving a draft, and accepts the offered ones', async () => {
    const f = await ledgerFixture();
    expect(refusedCode(await bookEntry(f.deps, f.ctx, expense(f, 'standard')))).toMatchObject({ type: 'validation', issues: [{ path: 'allocationLines.0.taxCode', message: 'taxCodeNotOffered' }] });
    expect(refusedCode(await saveDraft(f.deps, f.ctx, expense(f, 'rc13bEu')))).toMatchObject({ type: 'validation', issues: [{ path: 'allocationLines.0.taxCode', message: 'rc13bEuNeedsVatId' }] });
    expect(unwrap(await bookEntry(f.deps, f.ctx, expense(f, 'rc13bOther'))).allocationLines[0]!.taxCode).toBe('rc13bOther');
    expect(unwrap(await saveDraft(f.deps, f.ctx, expense(f, 'none'))).allocationLines[0]!.taxCode).toBe('none');
  });

  it('keeps a code that already stood on the draft', async () => {
    const f = await ledgerFixture();
    unwrap(await saveVatSettings(f.deps, f.ctx, { validFrom: '2026-01-01', vatEntrepreneur: true }));
    const draft = unwrap(await saveDraft(f.deps, f.ctx, expense(f, 'standard')));
    unwrap(await saveVatSettings(f.deps, f.ctx, { validFrom: '2026-02-01', vatEntrepreneur: false }));
    expect(refusedCode(await saveDraft(f.deps, f.ctx, expense(f, 'standard')))).toMatchObject({ type: 'validation' });
    expect(unwrap(await saveDraft(f.deps, f.ctx, { ...expense(f, 'standard'), id: draft.id, expectedVersion: draft.updatedAt })).allocationLines[0]!.taxCode).toBe('standard');
  });

  // N11 a (Nachttest 0.4.0, Joe 2026-10-27): Das Kennzeichen vom Entwurf bleibt erlaubt — das Festschreiben sagt aber,
  // dass es am Buchungstag nicht mehr angeboten würde. Ein Hinweis, keine Sperre.
  it('finalizes a code from the draft that the day no longer offers, with a notice', async () => {
    const f = await ledgerFixture();
    unwrap(await saveVatSettings(f.deps, f.ctx, { validFrom: '2026-01-01', vatEntrepreneur: true }));
    const stale = unwrap(await saveDraft(f.deps, f.ctx, expense(f, 'standard')));
    const fine = unwrap(await saveDraft(f.deps, f.ctx, expense(f, 'rc13bOther')));
    const batch = unwrap(await saveDraft(f.deps, f.ctx, expense(f, 'standard')));
    unwrap(await saveVatSettings(f.deps, f.ctx, { validFrom: '2026-02-01', vatEntrepreneur: false }));
    const finalized = unwrap(await finalizeEntry(f.deps, f.ctx, { id: stale.id }));
    expect(finalized.status).toBe('final');
    expect(finalized.notices).toContain('taxCodeNotOffered');
    expect(finalized.taxCodeNotOffered).toEqual([{ lineId: stale.allocationLines[0]!.id, taxCode: 'standard' }]);
    expect(unwrap(await finalizeEntry(f.deps, f.ctx, { id: fine.id })).notices).not.toContain('taxCodeNotOffered');
    unwrap(await setReviewed(f.deps, f.ctx, { id: batch.id, reviewed: true }));
    expect(unwrap(await finalizeReviewed(f.deps, f.ctx, { ids: [batch.id] })).entries[0]!.notices).toContain('taxCodeNotOffered');
  });

  it('accepts the preset of the contact and of the e-invoice on the open item', async () => {
    const f = await ledgerFixture();
    const supplier = unwrap(await createContact(f.deps, { ...systemContext(), permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Anzeigen Test B.V.', country: 'NL' }));
    unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: supplier.id, reverseCharge: 'eu' }));
    expect(unwrap(await bookEntry(f.deps, f.ctx, expense(f, 'rc13bEu', { contactId: supplier.id }))).allocationLines[0]!.taxCode).toBe('rc13bEu');

    const item = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-05-01', amountCents: 11900, lineTemplate: [{ categoryId: f.programCosts.id, taxCode: 'rc13bEu' }] }));
    const settled = { ...expense(f, 'rc13bEu'), moneyLines: [{ accountId: f.bank.id, amountCents: -11900, settlements: [{ openItemId: item.id, amountCents: 11900 }] }] };
    expect(unwrap(await bookEntry(f.deps, f.ctx, settled)).allocationLines[0]!.taxCode).toBe('rc13bEu');
  });

  it('refuses a correction to a code outside the choice, unless the contact presets it', async () => {
    const f = await ledgerFixture();
    const entry = unwrap(await bookEntry(f.deps, f.ctx, expense(f, 'none')));
    const lineId = entry.allocationLines[0]!.id;
    expect(refusedCode(await requestAllocationCorrection(f.deps, f.ctx, { lineId, changes: { taxCode: 'rc13bEu' }, note: 'Leistung aus der EU' }))).toMatchObject({ type: 'validation', issues: [{ path: 'changes.taxCode', message: 'rc13bEuNeedsVatId' }] });
    expect(unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId, changes: { taxCode: 'rc13bOther' }, note: 'Handwerker aus dem Ausland' })).applied).toBe(true);

    const supplier = unwrap(await createContact(f.deps, { ...systemContext(), permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Anzeigen Test B.V.', country: 'NL' }));
    unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: supplier.id, reverseCharge: 'eu' }));
    const other = unwrap(await bookEntry(f.deps, f.ctx, expense(f, 'none', { contactId: supplier.id })));
    expect(unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: other.allocationLines[0]!.id, changes: { taxCode: 'rc13bEu' }, note: 'Merkmal am Kontakt' })).applied).toBe(true);
  });

  /** Plan E15 Task 2 (Befund 40, Frage 2): Der Korrekturdialog bietet genau an, was der Dienst annimmt. */
  it('names the codes a correction offers: choice of the day, the current code and the preset of the contact', async () => {
    const f = await ledgerFixture();
    expect(correctionTaxCodesInternal(f.deps.db, { entryDate: '2026-05-04', taxCode: 'none', contactId: null })).toEqual(['none', 'rc13bOther', 'icAcquisition']);
    expect(correctionTaxCodesInternal(f.deps.db, { entryDate: '2026-05-04', taxCode: 'rc13bEu', contactId: null })).toEqual(['none', 'rc13bEu', 'rc13bOther', 'icAcquisition']);
    const supplier = unwrap(await createContact(f.deps, { ...systemContext(), permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Anzeigen Test B.V.', country: 'NL' }));
    unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: supplier.id, reverseCharge: 'eu' }));
    expect(correctionTaxCodesInternal(f.deps.db, { entryDate: '2026-05-04', taxCode: 'none', contactId: supplier.id })).toEqual(['none', 'rc13bEu', 'rc13bOther', 'icAcquisition']);
    // Gegenprobe: was nicht in der Liste steht, lehnt der Dienst ab.
    const entry = unwrap(await bookEntry(f.deps, f.ctx, expense(f, 'none')));
    expect(refusedCode(await requestAllocationCorrection(f.deps, f.ctx, { lineId: entry.allocationLines[0]!.id, changes: { taxCode: 'rc13bEu' }, note: 'Leistung aus der EU' }))).toMatchObject({ type: 'validation' });
  });
});

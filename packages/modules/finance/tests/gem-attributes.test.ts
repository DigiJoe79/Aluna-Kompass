import { unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getContactTaxDetails, saveContactTaxDetails } from '../src/allocation/contact-tax-details';
import { getPartnerPayment, savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { getPartner, savePartnerProfile } from '../src/allocation/partners';
import { createCategory } from '../src/ledger/categories';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { financeAllocationLines, financeCategories, financePartnerPayments } from '../src/schema';
import { ledgerFixture } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));
const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));

async function setup() {
  const f = await ledgerFixture();
  const cat = (key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!;
  const contactCtx = { ...f.ctx, permissions: new Set(['contacts.manage']) };
  const org = unwrap(await createContact(f.deps, contactCtx, { kind: 'organization', name: 'Stiftung Beispiel' }));
  const book = (line: Record<string, unknown>, cents = 10000) => bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Eingang', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ amountCents: cents, ...line }] });
  const lineOf = (entryId: string) => f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, entryId)).get()!;
  return { f, cat, org, book, lineOf, contactCtx };
}

describe('Merkmale für die Anlage Gem (Rechenschaft D2 Task 3)', () => {
  it('defaults inheritances to assets and asks why when unticked', async () => {
    const { f, cat, book, lineOf } = await setup();
    const inheritance = cat('inheritances').id;
    expect(lineOf(unwrap(await book({ categoryId: inheritance })).id).addsToAssets).toBe(true);
    expect(fields(await book({ categoryId: inheritance, addsToAssets: false }))).toEqual(['allocationLines.0.addsToAssetsOptOut:required']);
    const optedOut = lineOf(unwrap(await book({ categoryId: inheritance, addsToAssets: false, addsToAssetsOptOut: 'testatorDirectedCurrentUse' })).id);
    expect(optedOut).toMatchObject({ addsToAssets: false, addsToAssetsOptOut: 'testatorDirectedCurrentUse' });
    expect(fields(await book({ categoryId: f.donations.id, addsToAssetsOptOut: 'testatorDirectedCurrentUse' }))).toEqual(['allocationLines.0.addsToAssetsOptOut:notApplicable']);
    expect(fields(await book({ categoryId: inheritance, addsToAssets: false, addsToAssetsOptOut: 'donorAllowedCurrentUse' }))).toEqual(['allocationLines.0.addsToAssetsOptOut:notApplicable']);
    // Auch ein Entwurf prüft das.
    expect(fields(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'x', moneyLines: [], allocationLines: [{ categoryId: inheritance, amountCents: 100, addsToAssets: false }] }))).toEqual(['allocationLines.0.addsToAssetsOptOut:required']);
  });

  it('marks a received endowment only on a grant from another body, and adds it to assets unless the donor allowed current use', async () => {
    const { f, cat, org, book, lineOf } = await setup();
    const grant = cat('body-grants').id;
    const received = lineOf(unwrap(await book({ categoryId: grant, contactId: org.id, assetEndowment: true })).id);
    expect(received).toMatchObject({ assetEndowment: true, addsToAssets: true });
    expect(fields(await book({ categoryId: grant, assetEndowment: true }))).toEqual(['allocationLines.0.assetEndowment:notApplicable']);
    expect(fields(await book({ categoryId: f.donations.id, contactId: org.id, assetEndowment: true }))).toEqual(['allocationLines.0.assetEndowment:notApplicable']);
    expect(fields(await book({ categoryId: grant, contactId: org.id, assetEndowment: true, addsToAssets: false }))).toEqual(['allocationLines.0.addsToAssetsOptOut:required']);
    const allowed = lineOf(unwrap(await book({ categoryId: grant, contactId: org.id, assetEndowment: true, addsToAssets: false, addsToAssetsOptOut: 'donorAllowedCurrentUse' })).id);
    expect(allowed).toMatchObject({ assetEndowment: true, addsToAssets: false, addsToAssetsOptOut: 'donorAllowedCurrentUse' });
  });

  it('marks a given endowment only for a tax-exempt or public body, fixed from submitting on', async () => {
    const { f, org, contactCtx } = await setup();
    const foreign = unwrap(await createContact(f.deps, contactCtx, { kind: 'organization', name: 'Partner im Ausland' }));
    const body = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' }));
    const abroad = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: foreign.id, status: 'foreignBody', usualBasis: 'transfer58' }));
    const position = [{ kind: 'money', amountCents: 5000, categoryId: f.programCosts.id }];
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: body.id, basis: 'transfer58', purposeText: 'Ausstattung', retroactive: false, assetEndowment: true, positions: position }));
    expect(draft.assetEndowment).toBe(true);
    expect(fields(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: abroad.id, basis: 'transfer58', purposeText: 'x', retroactive: false, assetEndowment: true, positions: position }))).toEqual(['assetEndowment:notApplicable']);
    expect(fields(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: body.id, basis: 'agent57', basisOverrideReason: 'Auftrag', purposeText: 'x', retroactive: false, assetEndowment: true, positions: position }))).toEqual(['assetEndowment:notApplicable']);
    unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version }));
    expect(() => f.deps.db.update(financePartnerPayments).set({ assetEndowment: false }).where(eq(financePartnerPayments.id, draft.id)).run()).toThrow(/permanent/);
    expect(unwrap(await getPartnerPayment(f.deps, f.ctx, { id: draft.id })).assetEndowment).toBe(true);
  });

  it('hints when received endowment funds would be passed on as an endowment again (§ 58 Nr. 3 S. 3 AO)', async () => {
    const { f, cat, org, book, contactCtx } = await setup();
    const other = unwrap(await createContact(f.deps, contactCtx, { kind: 'organization', name: 'Förderverein Beispiel' }));
    const body = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: other.id, status: 'taxExemptBody' }));
    const position = (purposeId: string | null) => [{ kind: 'money', amountCents: 5000, categoryId: f.programCosts.id, purposeId }];
    unwrap(await book({ categoryId: cat('body-grants').id, contactId: org.id, assetEndowment: true, purposeId: f.abroadPurpose.id }));
    const passedOn = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: body.id, basis: 'transfer58', purposeText: 'x', retroactive: false, assetEndowment: true, positions: position(f.abroadPurpose.id) }));
    expect(passedOn.hints).toEqual(['endowmentPassedOn']);
    const plain = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: body.id, basis: 'transfer58', purposeText: 'x', retroactive: false, assetEndowment: true, positions: position(null) }));
    expect(plain.hints).toEqual([]);
  });

  it('keeps tax details per contact', async () => {
    const { f, org } = await setup();
    expect(unwrap(await getContactTaxDetails(f.deps, f.ctx, { contactId: org.id }))).toBeNull();
    const saved = unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: org.id, taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', beneficiaryPurpose: '' }));
    expect(saved).toMatchObject({ contactId: org.id, taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', beneficiaryPurpose: null });
    // Der Zweck ist eine Nummer aus § 52 Abs. 2 AO (Designer Runde 7, Abweichung 6); ein Freitext wird abgelehnt.
    expect(code(await saveContactTaxDetails(f.deps, f.ctx, { contactId: org.id, beneficiaryPurpose: 'Förderung des Tierschutzes' }))).toBe('validation');
    const changed = unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: org.id, beneficiaryPurpose: '14' }));
    expect(changed).toMatchObject({ taxOffice: 'Finanzamt Musterstadt', beneficiaryPurpose: '14' });
    const entry = auditEntry(f.deps, 'finance.contactTaxDetails.save');
    expect(entry.params).toBeNull();
    expect(`${entry.before}${entry.after}${entry.entityId}`).not.toMatch(/Musterstadt|99\/999|Tierschutz/);
    expect(entry.entityId).not.toBe(org.id);
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' }));
    expect(unwrap(await getPartner(f.deps, f.ctx, { id: partner.id }))!.taxDetails).toEqual({ taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', beneficiaryPurpose: '14', reverseCharge: null, reverseChargeDecline: null });
    expect(code(await saveContactTaxDetails(f.deps, ctxWith(['finance.read'], f.userId), { contactId: org.id, taxOffice: 'x' }))).toBe('forbidden');
    expect(code(await getContactTaxDetails(f.deps, ctxWith(['finance.overview'], f.userId), { contactId: org.id }))).toBe('forbidden');
    expect(code(await saveContactTaxDetails(f.deps, f.ctx, { contactId: 'NOPE', taxOffice: 'x' }))).toBe('notFound');
  });

  it('knows rent as an income kind of asset management, also over the agent schema', async () => {
    const { f } = await setup();
    const rent = unwrap(await createCategory(f.deps, f.ctx, { key: 'room-rent', name: 'Raummiete', direction: 'income', sphere: 'assetManagement', incomeKind: 'rent' }));
    expect(rent.incomeKind).toBe('rent');
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_master_data_save')!;
    const parsed = tool.inputSchema.parse({ kind: 'category', data: { key: 'garage-rent', name: 'Garagenpacht', direction: 'income', sphere: 'assetManagement', incomeKind: 'rent' } }) as { data: { incomeKind: string } };
    expect(parsed.data.incomeKind).toBe('rent');
  });
});

describe('§ 52 Abs. 2 AO als Liste (Designer Runde 7, Abweichung 6)', () => {
  it('has the 27 purposes with their numbers, finds a stored number and the purposes named in a notice', async () => {
    const { AO52_PURPOSES, ao52PurposeOf, ao52NumbersIn } = await import('../src/format/tax-purposes');
    expect(AO52_PURPOSES.map((p) => p.number)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
    expect(ao52PurposeOf('21')?.text).toBe('die Förderung des Sports (Schach und E-Sport gelten als Sport)');
    expect(ao52PurposeOf('27')?.text).toBe('die Förderung wohngemeinnütziger Zwecke; dies ist die vergünstigte Wohnraumüberlassung an Personen im Sinne des § 53');
    expect(ao52NumbersIn('Förderung wohngemeinnütziger Zwecke')).toEqual([27]);
    expect(ao52PurposeOf('14')?.text).toBe('die Förderung des Tierschutzes');
    expect(ao52PurposeOf('Förderung des Tierschutzes')).toBeNull();
    expect(ao52NumbersIn('Förderung des Tierschutzes')).toEqual([14]);
    expect(ao52NumbersIn('des Tierschutzes (§ 52 Abs. 2 Satz 1 Nr. 14 AO) und der Jugendhilfe (§ 52 Abs. 2 Satz 1 Nr. 4 AO)')).toEqual([4, 14]);
    expect(ao52NumbersIn('')).toEqual([]);
  });
});

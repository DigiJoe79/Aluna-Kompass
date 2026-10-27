import { fakeTextExtraction, unwrap } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { extractDocumentText, receiveDocument } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';
import { declineReverseCharge, saveContactTaxDetails } from '../src/allocation/contact-tax-details';
import { savePartnerProfile } from '../src/allocation/partners';
import { financeCategories } from '../src/schema';
import { eq } from 'drizzle-orm';
import { buildInvoiceXml } from '../src/import/zugferd-fixture';
import { checkReverseCharge, countryOfVatId, findReverseChargePhrase } from '../src/import/reverse-charge-check';
import { setDatedValue } from '../src/ledger/dated-values';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { z } from 'zod';
import { insertRaw, insertRun, ledgerFixture, pdfBytes } from './helpers';

type F = Awaited<ReturnType<typeof ledgerFixture>>;
type Taxes = { rate: string; category: string; basis: string; tax: string }[];
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? null : (r.error as { type: string; code?: string }));
const code = (r: { ok: boolean; error?: unknown }) => { const e = err(r); return e ? (e.code ?? e.type) : 'ok'; };

async function fixture(opts: { entrepreneur?: boolean; vatId?: string; pages?: { page: number; text: string }[]; invoice?: { sellerVatId?: string; taxes: Taxes; taxTotal: string } } = {}) {
  const f = await ledgerFixture();
  f.deps.clock.set('2026-10-25T09:00:00.000Z');
  if (opts.entrepreneur !== false) unwrap(await setDatedValue(f.deps, f.ctx, { key: 'vatEntrepreneur', validFrom: '2026-01-01', value: true }));
  if (opts.vatId) unwrap(await setDatedValue(f.deps, f.ctx, { key: 'vatId', validFrom: '2026-01-01', value: opts.vatId }));
  f.deps.textExtraction = fakeTextExtraction({
    pages: (opts.pages ?? [{ page: 1, text: 'Rechnung' }]).map((p) => ({ ...p, source: 'layer' as const })),
    embedded: opts.invoice ? [{ name: 'factur-x.xml', mimeType: 'application/xml', bytes: new TextEncoder().encode(buildInvoiceXml({ seller: 'Anzeigenwerk Test Ltd.', iban: null, sellerVatId: opts.invoice.sellerVatId, taxes: opts.invoice.taxes, taxTotal: opts.invoice.taxTotal })) }] : [],
  });
  return f;
}

const contact = async (f: F, country: string | null, name = 'Anbieter Test') => unwrap(await createContact(f.deps, { ...systemContext(), permissions: new Set(['contacts.manage']) }, { kind: 'organization', name, ...(country ? { country } : {}) }));

async function voucher(f: F, withText: boolean): Promise<string> {
  const receiver = ctxWith([...FINANCE_PERMISSIONS, 'dms.create', 'dms.view', 'dms.manage'], f.userId);
  const doc = unwrap(await receiveDocument(f.deps, receiver, { filename: 'rechnung.pdf', typeKey: 'voucher-invoice', subject: 'Eingangsrechnung', documentDate: '2026-06-30', folder: null, bytes: pdfBytes() }));
  if (withText) unwrap(await extractDocumentText(f.deps, receiver, { documentId: doc.id }));
  return doc.id;
}

const check = (f: F, input: Record<string, unknown>) => checkReverseCharge(f.deps, ctxWith([...FINANCE_PERMISSIONS, 'dms.view'], f.userId), input);
const prompt = async (f: F, input: Record<string, unknown>) => unwrap(await check(f, input)).prompt;
const expense = [{ amountCents: -490, taxCode: null }];

/** Plan E6b Task 2 — Prüffrage § 13b aus Beleg, Sitz und ausgewiesener Steuer. */
describe('reverse charge check', () => {
  it('finds the phrases and the country of a VAT id', () => {
    expect(findReverseChargePhrase([{ page: 1, text: 'Total 200,00 EUR\nVAT: Reverse charge applies' }])).toEqual({ phrase: 'Reverse Charge', page: 1 });
    expect(findReverseChargePhrase([{ page: 1, text: 'Rechnung' }, { page: 2, text: 'Steuerschuldnerschaft des Leistungsempfängers' }])).toEqual({ phrase: 'Steuerschuldnerschaft des Leistungsempfängers', page: 2 });
    expect(findReverseChargePhrase([{ page: 1, text: 'Rechnung über Futter' }])).toBeNull();
    expect(countryOfVatId('IE6388047V')).toBe('IE');
    expect(countryOfVatId('EL123456789')).toBe('GR');
    expect(countryOfVatId(null)).toBeNull();
  });

  it('asks for a foreign provider without tax', async () => {
    const f = await fixture();
    const lu = await contact(f, 'LU', 'Zahlfix Test');
    expect(await prompt(f, { contactId: lu.id, lines: expense })).toEqual({ trigger: 'foreignNoTax', params: { country: 'LU' }, contact: { id: lu.id, name: 'Zahlfix Test', country: 'LU' }, suggestedCode: 'rc13bEu', lineIndexes: [0] });
    const gb = await contact(f, 'GB');
    expect(await prompt(f, { contactId: gb.id, lines: expense })).toMatchObject({ trigger: 'foreignNoTax', suggestedCode: 'rc13bOther' });
    const raw = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -490, iban: 'NL91ABNA0417164300' });
    expect(await prompt(f, { rawTransactionId: raw, lines: expense })).toMatchObject({ trigger: 'foreignNoTax', params: { country: 'NL' }, contact: null, suggestedCode: 'rc13bEu' });
  });

  it('reads the voucher text first', async () => {
    const f = await fixture({ pages: [{ page: 1, text: 'Invoice — Reverse Charge' }] });
    const de = await contact(f, 'DE');
    const documentId = await voucher(f, true);
    expect(await prompt(f, { contactId: de.id, documentId, lines: expense })).toMatchObject({ trigger: 'text', params: { phrase: 'Reverse Charge', page: 1 } });
    // Eine E-Rechnung mit Kategorie AE fragt nicht: Sie setzt das Kennzeichen selbst als Vorgabe (Joe, Designer Runde 8,
    // Fachlich 2); gefragt wird nur bei unsicheren Auslösern wie dem Textfund oben.
    const g = await fixture({ invoice: { taxes: [{ rate: '0', category: 'AE', basis: '200.00', tax: '0.00' }], taxTotal: '0.00' } });
    const gDe = await contact(g, 'DE');
    expect(await prompt(g, { contactId: gDe.id, documentId: await voucher(g, false), lines: expense })).toBeNull();
  });

  it('flags foreign and German VAT on foreign invoices', async () => {
    const f = await fixture({ invoice: { sellerVatId: 'IE6388047V', taxes: [{ rate: '23.00', category: 'S', basis: '200.00', tax: '46.00' }], taxTotal: '46.00' } });
    expect(await prompt(f, { documentId: await voucher(f, false), lines: expense })).toMatchObject({ trigger: 'foreignVat', params: { country: 'IE', ratePercent: 23 }, suggestedCode: 'rc13bEu' });
    const g = await fixture({ invoice: { taxes: [{ rate: '19.00', category: 'S', basis: '200.00', tax: '38.00' }], taxTotal: '38.00' } });
    const ie = await contact(g, 'IE');
    expect(await prompt(g, { contactId: ie.id, documentId: await voucher(g, false), lines: expense })).toMatchObject({ trigger: 'germanVatAbroad', params: { country: 'IE', ratePercent: 19 } });
    const h = await fixture({ invoice: { sellerVatId: 'DE123456789', taxes: [{ rate: '19.00', category: 'S', basis: '200.00', tax: '38.00' }], taxTotal: '38.00' } });
    const hIe = await contact(h, 'IE');
    expect(await prompt(h, { contactId: hIe.id, documentId: await voucher(h, false), lines: expense })).toBeNull();
  });

  // Befund 37 (Recherche 2026-10-26, A.2/A.5): Die juristische Person schuldet auch ohne Unternehmereigenschaft nach
  // § 13b Abs. 5 S. 1. Ohne USt-IdNr. greift § 3a Abs. 2 nicht — nur Abs. 2 Nr. 1 (Kz 84/85), und ausgewiesene Steuer
  // heißt: Der Anbieter hat sie erhoben (Ort im Ausland oder OSS), kein Prüffall.
  it('asks a legal person that is not an entrepreneur only where it owes the tax', async () => {
    const off = await fixture({ entrepreneur: false });
    const lu = await contact(off, 'LU');
    expect(await prompt(off, { contactId: lu.id, lines: expense })).toMatchObject({ trigger: 'foreignNoTax', params: { country: 'LU' }, suggestedCode: 'rc13bOther', lineIndexes: [0] });
    const text = await fixture({ entrepreneur: false, pages: [{ page: 1, text: 'Invoice — Reverse Charge' }] });
    expect(await prompt(text, { contactId: (await contact(text, 'NL')).id, documentId: await voucher(text, true), lines: expense })).toMatchObject({ trigger: 'text', suggestedCode: 'rc13bOther' });
    const foreignVat = await fixture({ entrepreneur: false, invoice: { sellerVatId: 'IE6388047V', taxes: [{ rate: '23.00', category: 'S', basis: '200.00', tax: '46.00' }], taxTotal: '46.00' } });
    expect(await prompt(foreignVat, { documentId: await voucher(foreignVat, false), lines: expense })).toBeNull();
    const germanVat = await fixture({ entrepreneur: false, invoice: { taxes: [{ rate: '19.00', category: 'S', basis: '200.00', tax: '38.00' }], taxTotal: '38.00' } });
    expect(await prompt(germanVat, { contactId: (await contact(germanVat, 'IE')).id, documentId: await voucher(germanVat, false), lines: expense })).toBeNull();
    // Mit USt-IdNr. steht sie einem Unternehmer gleich (§ 3a Abs. 2 S. 3, UStAE 3a.2 Abs. 7): alle Auslöser, EU-Vorschlag.
    const withId = await fixture({ entrepreneur: false, vatId: 'DE123456788', invoice: { sellerVatId: 'IE6388047V', taxes: [{ rate: '23.00', category: 'S', basis: '200.00', tax: '46.00' }], taxTotal: '46.00' } });
    expect(await prompt(withId, { contactId: (await contact(withId, 'LU')).id, lines: expense })).toMatchObject({ trigger: 'foreignNoTax', suggestedCode: 'rc13bEu' });
    expect(await prompt(withId, { documentId: await voucher(withId, false), lines: expense })).toMatchObject({ trigger: 'foreignVat', suggestedCode: 'rc13bEu' });
  });

  it('stays silent where nothing is to ask', async () => {
    const f = await fixture();
    const lu = await contact(f, 'LU');
    expect(await prompt(f, { contactId: lu.id, lines: [{ amountCents: 490, taxCode: null }] })).toBeNull();
    expect(await prompt(f, { contactId: lu.id, lines: [{ amountCents: -490, taxCode: 'standard' }] })).toBeNull();
    const marked = await contact(f, 'IE');
    unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: marked.id, reverseCharge: 'eu' }));
    expect(await prompt(f, { contactId: marked.id, lines: expense })).toBeNull();
    const declined = await contact(f, 'LU');
    unwrap(await declineReverseCharge(f.deps, f.ctx, { contactId: declined.id, reason: 'paymentServices' }));
    expect(await prompt(f, { contactId: declined.id, lines: expense })).toBeNull();
    expect(await prompt(f, { contactId: (await contact(f, 'DE')).id, lines: expense })).toBeNull();
    const raw = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -490, iban: 'DE25999999990000424242' });
    expect(await prompt(f, { rawTransactionId: raw, lines: expense })).toBeNull();
    expect((await prompt(f, { contactId: lu.id, lines: [{ amountCents: -100, taxCode: 'rc13bEu' }, { amountCents: -200, taxCode: 'none' }] }))!.lineIndexes).toEqual([1]);
  });

  // Joe 2026-10-26 (Designer Runde 8, Fachlich 1): Mittel an einen Partner sind keine Leistung — keine Prüffrage bei
  // Zahlungen an Partner und bei Zeilen, die als Mittelweitergabe gebucht sind (Kategorien der Partnerzahlungen).
  it('asks nothing for a partner or for lines booked as a grant to partners', async () => {
    const f = await fixture();
    const at = await contact(f, 'AT', 'Hilfswerk Test');
    expect(await prompt(f, { contactId: at.id, lines: expense })).not.toBeNull();
    unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: at.id, status: 'foreignBody', usualBasis: 'transfer58' }));
    expect(await prompt(f, { contactId: at.id, lines: expense })).toBeNull();
    const lu = await contact(f, 'LU');
    const grant = f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'partner-transfers')).get()!;
    const assignment = f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'partner-assignments')).get()!;
    expect(await prompt(f, { contactId: lu.id, lines: [{ amountCents: -490, taxCode: null, categoryId: grant.id }] })).toBeNull();
    expect(await prompt(f, { contactId: lu.id, lines: [{ amountCents: -490, taxCode: null, categoryId: assignment.id }] })).toBeNull();
    expect((await prompt(f, { contactId: lu.id, lines: [{ amountCents: -490, taxCode: null, categoryId: grant.id }, { amountCents: -100, taxCode: null, categoryId: f.programCosts.id }] }))!.lineIndexes).toEqual([1]);
  });

  // N1 (MCP-Nachttest 0.4.0): Das SDK parst mit dem Werkzeugschema, bevor der Dienst die Zeilen sieht — ohne
  // `categoryId` im Schema griff die Ausnahme nach Kategorie über MCP nie.
  it('keeps the category of a line through the MCP schema', async () => {
    const f = await fixture();
    const lu = await contact(f, 'LU');
    const grant = f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'partner-transfers')).get()!;
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_reverse_charge_check')!;
    const args = (tool.inputSchema as z.ZodType).parse({ contactId: lu.id, lines: [{ amountCents: -490, taxCode: null, categoryId: grant.id }] });
    expect(await tool.handler(f.deps, f.ctx, args)).toMatchObject({ ok: true, value: { prompt: null } });
  });

  it('checks rights and the contact', async () => {
    const f = await fixture();
    expect(code(await checkReverseCharge(f.deps, ctxWith([], f.userId), { lines: expense }))).toBe('forbidden');
    expect(code(await check(f, { contactId: 'unbekannt', lines: expense }))).toBe('notFound');
  });
});

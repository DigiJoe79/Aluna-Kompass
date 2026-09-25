import { fakeTextExtraction, schema, unwrap, type CallContext, type EmbeddedFile, type TextExtraction } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { receiveDocument } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { linkContactIban } from '../src/import/contact-ibans';
import { applyInvoiceToDraft, createOpenItemFromInvoice, invoiceProposal, readInvoiceFromDocument } from '../src/import/zugferd/read';
import { setDatedValue } from '../src/ledger/dated-values';
import { getEntry, saveDraft } from '../src/ledger/entries';
import { createOpenItem } from '../src/ledger/open-items';
import { attachDocument } from '../src/ledger/vouchers';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeOpenItems } from '../src/schema';
import { insertRaw, insertRun, ledgerFixture, pdfBytes } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

/** Erfundene IBANs mit BLZ 99999999 (Wächter `example-ibans`). */
const PAYEE_IBAN = 'DE25999999990000424242';
const OTHER_IBAN = 'DE86999999990000777000';

interface InvoiceSpec {
  number?: string;
  issue?: string;
  seller?: string;
  currency?: string;
  typeCode?: string;
  grand?: string;
  due?: string;
  taxTotal?: string;
  taxes?: { rate: string; category: string; basis: string; tax: string }[];
  dueDate?: string | null;
  iban?: string | null;
}

/** Eine CII-Rechnung wie die EN16931-Fixture aus `zugferd-parse.test.ts` — hier mit wählbaren Feldern. */
function invoiceXml(o: InvoiceSpec = {}): string {
  const taxes = o.taxes ?? [{ rate: '19.00', category: 'S', basis: '100.00', tax: '19.00' }];
  const dueDate = o.dueDate === undefined ? '20260430' : o.dueDate;
  const iban = o.iban === undefined ? PAYEE_IBAN : o.iban;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${o.number ?? 'TM-2026-0042'}</ram:ID>
    <ram:TypeCode>${o.typeCode ?? '380'}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${o.issue ?? '20260401'}</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>${o.seller ?? 'Tierarztpraxis Muster'}</ram:Name></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Beispielverein e.V.</ram:Name></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${o.currency ?? 'EUR'}</ram:InvoiceCurrencyCode>
      ${iban ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${iban}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>` : ''}
      ${taxes.map((t) => `<ram:ApplicableTradeTax><ram:CalculatedAmount>${t.tax}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${t.basis}</ram:BasisAmount><ram:CategoryCode>${t.category}</ram:CategoryCode><ram:RateApplicablePercent>${t.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`).join('\n      ')}
      ${dueDate ? `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${dueDate}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>` : ''}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxTotalAmount currencyID="${o.currency ?? 'EUR'}">${o.taxTotal ?? '19.00'}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${o.grand ?? '119.00'}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${o.due ?? o.grand ?? '119.00'}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

const attachment = (xml: string, name = 'factur-x.xml'): EmbeddedFile => ({ name, bytes: new TextEncoder().encode(xml), mimeType: 'application/xml' });

/** Wie `@kompass/text-extraction` — der Finanzcode darf das Paket nicht importieren und erkennt den Fehler am Namen. */
class ToolMissingError extends Error {
  override name = 'ToolMissingError';
}

/**
 * Ledger-Fixture plus ein Finanzbeleg in der Akte, über den Empfang der Akte
 * angelegt (echte Datei, echte Prüfsumme). Die Texterkennung ist eine
 * Attrappe, die die gegebenen Anhänge liefert.
 */
async function withInvoice(embedded: EmbeddedFile[] | TextExtraction, opts: { typeKey?: string } = {}) {
  const f = await ledgerFixture();
  f.deps.textExtraction = Array.isArray(embedded) ? fakeTextExtraction({ embedded }) : embedded;
  const receiver = ctxWith([...FINANCE_PERMISSIONS, 'dms.create', 'dms.view'], f.userId);
  const doc = unwrap(await receiveDocument(f.deps, receiver, { filename: 'rechnung.pdf', typeKey: opts.typeKey ?? 'voucher-invoice', subject: 'Eingangsrechnung', documentDate: '2026-04-01', folder: null, bytes: pdfBytes() }));
  return { ...f, documentId: doc.id };
}

/** Finanzleser ohne jedes Recht der Akte — die Belegarten tragen den Schutzbereich `finance`, dessen Recht `finance.read` ist. */
const financeReader = (f: Fixture) => ctxWith(['finance.read'], f.userId);

const auditRows = (f: Fixture) => f.deps.db.select().from(schema.auditLog).all();

async function supplierWithIban(f: Fixture): Promise<string> {
  const contactsCtx: CallContext = { ...f.ctx, permissions: new Set([...f.ctx.permissions, 'contacts.manage']) };
  const contact = unwrap(await createContact(f.deps, contactsCtx, { kind: 'organization', name: 'Tierarztpraxis Muster' }));
  unwrap(await linkContactIban(f.deps, f.ctx, { contactId: contact.id, iban: PAYEE_IBAN }));
  return contact.id;
}

describe('readInvoiceFromDocument', () => {
  it('reads the invoice of a document the caller may read and maps the tax rate to a tax code at the issue date', async () => {
    const f = await withInvoice([attachment(invoiceXml({ taxTotal: '19.01' }))]);
    const supplier = await supplierWithIban(f);

    const view = unwrap(await readInvoiceFromDocument(f.deps, financeReader(f), { documentId: f.documentId }));
    expect(view).toMatchObject({
      sellerName: 'Tierarztpraxis Muster', invoiceNumber: 'TM-2026-0042', issueDate: '2026-04-01', grandTotalCents: 11900, duePayableCents: 11900,
      dueDate: '2026-04-30', payeeIban: PAYEE_IBAN, taxCode: 'standard', contactId: supplier, contactName: 'Tierarztpraxis Muster',
    });
    // 119,00 brutto zu 19 % → 19,00 berechnet; die Rechnung nennt 19,01.
    expect(view!.taxCentsDifference).toBe(1);

    // Der Satz gilt am Rechnungsdatum: ab dem 01.07.2026 sind 16 % der Regelsatz, davor nicht.
    const reduced = await withInvoice([attachment(invoiceXml({ taxes: [{ rate: '7', category: 'S', basis: '100.00', tax: '7.00' }], grand: '107.00', taxTotal: '7.00' }))]);
    expect(unwrap(await readInvoiceFromDocument(reduced.deps, financeReader(reduced), { documentId: reduced.documentId }))).toMatchObject({ taxCode: 'reduced', taxCentsDifference: 0, contactId: null, contactName: null });

    const later = await withInvoice([attachment(invoiceXml({ issue: '20260801', taxes: [{ rate: '16', category: 'S', basis: '100.00', tax: '16.00' }], grand: '116.00', taxTotal: '16.00' }))]);
    unwrap(await setDatedValue(later.deps, later.ctx, { key: 'vatStandard', validFrom: '2026-07-01', value: 16 }));
    expect(unwrap(await readInvoiceFromDocument(later.deps, financeReader(later), { documentId: later.documentId }))).toMatchObject({ taxCode: 'standard', taxCentsDifference: 0 });
    const before = await withInvoice([attachment(invoiceXml({ issue: '20260601', taxes: [{ rate: '16', category: 'S', basis: '100.00', tax: '16.00' }], grand: '116.00', taxTotal: '16.00' }))]);
    unwrap(await setDatedValue(before.deps, before.ctx, { key: 'vatStandard', validFrom: '2026-07-01', value: 16 }));
    expect(unwrap(await readInvoiceFromDocument(before.deps, financeReader(before), { documentId: before.documentId }))).toMatchObject({ taxCode: null, taxCentsDifference: null });

    const exempt = await withInvoice([attachment(invoiceXml({ taxes: [{ rate: '0', category: 'E', basis: '100.00', tax: '0.00' }], grand: '100.00', taxTotal: '0.00' }))]);
    expect(unwrap(await readInvoiceFromDocument(exempt.deps, financeReader(exempt), { documentId: exempt.documentId }))).toMatchObject({ taxCode: 'none', taxCentsDifference: 0 });

    const twoRates = await withInvoice([attachment(invoiceXml({ taxes: [{ rate: '19', category: 'S', basis: '100.00', tax: '19.00' }, { rate: '7', category: 'S', basis: '50.00', tax: '3.50' }], grand: '172.50', taxTotal: '22.50' }))]);
    expect(unwrap(await readInvoiceFromDocument(twoRates.deps, financeReader(twoRates), { documentId: twoRates.documentId }))).toMatchObject({ taxCode: null, taxCentsDifference: null });
  });

  it('reads only attachments with an invoice name and returns null without one', async () => {
    const f = await withInvoice([attachment(invoiceXml(), 'anlage.xml'), attachment('<x/>', 'lies-mich.txt')]);
    expect(unwrap(await readInvoiceFromDocument(f.deps, financeReader(f), { documentId: f.documentId }))).toBeNull();
    const upper = await withInvoice([attachment(invoiceXml(), 'ZUGFeRD-invoice.xml')]);
    expect(unwrap(await readInvoiceFromDocument(upper.deps, financeReader(upper), { documentId: upper.documentId }))).toMatchObject({ invoiceNumber: 'TM-2026-0042' });
  });

  it('refuses a foreign xml under an invoice name with a named code, never a throw', async () => {
    const f = await withInvoice([attachment('<?xml version="1.0"?><Order><ID>1</ID></Order>')]);
    expect(await readInvoiceFromDocument(f.deps, financeReader(f), { documentId: f.documentId })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'invoiceUnreadable' } });
    expect(unwrap(await invoiceProposal(f.deps, financeReader(f), { documentId: f.documentId }))).toEqual({ kind: 'unsupported', code: 'notAnInvoice' });
  });

  it('forbidden, validation and no audit entry', async () => {
    const f = await withInvoice([attachment(invoiceXml())]);
    expect(await readInvoiceFromDocument(f.deps, ctxWith(['finance.overview'], f.userId), { documentId: f.documentId })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.read' } });
    expect(await readInvoiceFromDocument(f.deps, financeReader(f), {})).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await readInvoiceFromDocument(f.deps, financeReader(f), { documentId: 'nope' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    const before = auditRows(f).length;
    unwrap(await readInvoiceFromDocument(f.deps, financeReader(f), { documentId: f.documentId }));
    expect(auditRows(f)).toHaveLength(before);
  });

  it('asks the file whether the caller may read the document', async () => {
    const f = await withInvoice([attachment(invoiceXml())], { typeKey: 'voucher-invoice' });
    // Finanzleser ohne Schutzbereich-Recht gibt es nicht — der Bereich `finance` hängt an `finance.read`.
    // Eine Art ohne Bereich (Brief) verlangt dagegen `dms.view`.
    const { documentTypes } = await import('@kompass/module-dms');
    f.deps.db.insert(documentTypes).values({ key: 'letter', label: 'Brief', prefix: 'BRF', defaultDirection: 'incoming', retentionClass: 'statutory6Y', defaultFolder: null, isActive: true, sortOrder: 0, ownerModule: null, protectionArea: null }).run();
    const letter = unwrap(await receiveDocument(f.deps, ctxWith(['dms.create', 'dms.view'], f.userId), { filename: 'b.pdf', typeKey: 'letter', subject: 'Brief', documentDate: '2026-04-01', folder: null, bytes: pdfBytes() }));
    expect(await readInvoiceFromDocument(f.deps, financeReader(f), { documentId: letter.id })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'dms.view' } });
  });
});

describe('invoiceProposal', () => {
  it('reports noInvoice without an audit entry', async () => {
    const f = await withInvoice([]);
    const before = auditRows(f).length;
    expect(unwrap(await invoiceProposal(f.deps, financeReader(f), { documentId: f.documentId }))).toEqual({ kind: 'noInvoice' });
    expect(auditRows(f)).toHaveLength(before);
    expect(await invoiceProposal(f.deps, ctxWith(['finance.overview'], f.userId), { documentId: f.documentId })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.read' } });
    expect(await invoiceProposal(f.deps, financeReader(f), { documentId: '' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('finds the paid transaction by iban or invoice number and proposes a draft', async () => {
    const f = await withInvoice([attachment(invoiceXml())]);
    const run = insertRun(f, f.bank.id);
    insertRaw(f, run, { accountId: f.bank.id, amountCents: -11900, iban: PAYEE_IBAN, date: '2026-03-01' }); // 31 Tage vorher: außerhalb
    insertRaw(f, run, { accountId: f.bank.id, amountCents: -11800, iban: PAYEE_IBAN, date: '2026-04-10' }); // anderer Betrag
    const byIban = insertRaw(f, run, { accountId: f.bank.id, amountCents: -11900, iban: PAYEE_IBAN, date: '2026-04-12', purpose: 'Rechnung' });

    const paid = unwrap(await invoiceProposal(f.deps, financeReader(f), { documentId: f.documentId }));
    expect(paid).toMatchObject({ kind: 'paid', rawTransactionId: byIban, bookingDate: '2026-04-12', sure: true, invoice: { invoiceNumber: 'TM-2026-0042' } });

    const g = await withInvoice([attachment(invoiceXml())]);
    const byNumber = insertRaw(g, insertRun(g, g.bank.id), { accountId: g.bank.id, amountCents: -11900, iban: OTHER_IBAN, date: '2026-06-29', purpose: 'Re. tm-2026-0042 Kd 17' });
    expect(unwrap(await invoiceProposal(g.deps, financeReader(g), { documentId: g.documentId }))).toMatchObject({ kind: 'paid', rawTransactionId: byNumber, sure: true });
  });

  it('lists several amount-only matches as possible payments instead of picking one', async () => {
    const f = await withInvoice([attachment(invoiceXml())]);
    const run = insertRun(f, f.bank.id);
    const first = insertRaw(f, run, { accountId: f.bank.id, amountCents: -11900, iban: OTHER_IBAN, date: '2026-04-05', purpose: 'Dauerauftrag' });
    const second = insertRaw(f, run, { accountId: f.bank.id, amountCents: -11900, iban: null, date: '2026-05-05', purpose: 'Dauerauftrag' });
    insertRaw(f, run, { accountId: f.bank.id, amountCents: 11900, iban: PAYEE_IBAN, date: '2026-04-05' }); // Eingang, nicht die Zahlung

    const proposal = unwrap(await invoiceProposal(f.deps, financeReader(f), { documentId: f.documentId }));
    expect(proposal.kind).toBe('possiblyPaid');
    if (proposal.kind !== 'possiblyPaid') return;
    expect(proposal.candidates).toEqual([
      { rawTransactionId: first, bookingDate: '2026-04-05', accountName: 'Vereinskonto' },
      { rawTransactionId: second, bookingDate: '2026-05-05', accountName: 'Vereinskonto' },
    ]);
  });

  it('proposes an open item with the invoice number as payment reference when unpaid, and reports an existing one', async () => {
    const f = await withInvoice([attachment(invoiceXml())]);
    // Ein gebundener Umsatz (Entwurf) mit passendem Betrag zählt nicht — er ist nicht mehr offen.
    const run = insertRun(f, f.bank.id);
    const bound = insertRaw(f, run, { accountId: f.bank.id, amountCents: -11900, iban: PAYEE_IBAN, date: '2026-04-12' });
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-04-12', text: 'Anderes', moneyLines: [{ accountId: f.bank.id, amountCents: -11900, rawTransactionId: bound }], allocationLines: [] }));

    expect(unwrap(await invoiceProposal(f.deps, financeReader(f), { documentId: f.documentId }))).toMatchObject({ kind: 'unpaid', existingOpenItemId: null, invoice: { paymentReference: null, invoiceNumber: 'TM-2026-0042' } });

    const byReference = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-04-01', amountCents: 11900, paymentReference: 'TM-2026-0042' }));
    expect(unwrap(await invoiceProposal(f.deps, financeReader(f), { documentId: f.documentId }))).toMatchObject({ kind: 'unpaid', existingOpenItemId: byReference.id });

    const g = await withInvoice([attachment(invoiceXml())]);
    const byDocument = unwrap(await createOpenItemFromInvoice(g.deps, g.ctx, { documentId: g.documentId }));
    expect(unwrap(await invoiceProposal(g.deps, financeReader(g), { documentId: g.documentId }))).toMatchObject({ kind: 'unpaid', existingOpenItemId: byDocument.id });
  });

  it('reports the entry when the document is already a voucher', async () => {
    const f = await withInvoice([attachment(invoiceXml())]);
    const entry = await f.finalEntry();
    unwrap(await attachDocument(f.deps, f.ctx, { entryId: entry.id, documentId: f.documentId }));
    expect(unwrap(await invoiceProposal(f.deps, financeReader(f), { documentId: f.documentId }))).toEqual({ kind: 'alreadyVoucher', entryId: entry.id, entryNumber: entry.number });
  });

  it('refuses a foreign currency', async () => {
    const f = await withInvoice([attachment(invoiceXml({ currency: 'CHF' }))]);
    expect(unwrap(await readInvoiceFromDocument(f.deps, financeReader(f), { documentId: f.documentId }))).toMatchObject({ currency: 'CHF' });
    expect(unwrap(await invoiceProposal(f.deps, financeReader(f), { documentId: f.documentId }))).toEqual({ kind: 'unsupported', code: 'currencyUnsupported' });
    expect(await createOpenItemFromInvoice(f.deps, f.ctx, { documentId: f.documentId })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'invoiceCurrencyUnsupported' } });
    expect(f.deps.db.select().from(financeOpenItems).all()).toHaveLength(0);
  });

  it('answers with a remedy when the tools are missing', async () => {
    const missing: TextExtraction = {
      ...fakeTextExtraction({ probe: { ok: false, error: 'pdfdetach ist nicht installiert' } }),
      embeddedFiles: async () => {
        throw new ToolMissingError('pdfdetach ist nicht installiert');
      },
    };
    const f = await withInvoice(missing);
    const read = await readInvoiceFromDocument(f.deps, financeReader(f), { documentId: f.documentId });
    expect(read).toMatchObject({ ok: false, error: { type: 'conflict', code: 'invoiceToolsMissing' } });
    if (!read.ok && read.error.type === 'conflict') expect(read.error.message).toContain('betrieb.md');
    expect(unwrap(await invoiceProposal(f.deps, financeReader(f), { documentId: f.documentId }))).toEqual({ kind: 'unsupported', code: 'toolsMissing' });

    // Auch ohne erkennbaren Namen: meldet die Umgebung fehlende Werkzeuge, gilt jeder Fehler als dieser.
    const anonymous: TextExtraction = { ...missing, embeddedFiles: async () => { throw new Error('ENOENT'); } };
    const g = await withInvoice(anonymous);
    expect(await readInvoiceFromDocument(g.deps, financeReader(g), { documentId: g.documentId })).toMatchObject({ ok: false, error: { code: 'invoiceToolsMissing' } });
  });
});

describe('createOpenItemFromInvoice', () => {
  it('creates the payable with the document and the line template, once per document', async () => {
    const f = await withInvoice([attachment(invoiceXml())]);
    const supplier = await supplierWithIban(f);
    const item = unwrap(await createOpenItemFromInvoice(f.deps, f.ctx, { documentId: f.documentId }));
    expect(item).toMatchObject({ kind: 'payable', itemDate: '2026-04-01', amountCents: 11900, dueOn: '2026-04-30', documentId: f.documentId, paymentReference: 'TM-2026-0042', contactId: supplier, state: 'open' });
    expect(JSON.parse(item.lineTemplate!)).toEqual([{ taxCode: 'standard', contactId: supplier }]);

    expect(await createOpenItemFromInvoice(f.deps, f.ctx, { documentId: f.documentId })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'openItemExistsForDocument' } });
    expect(f.deps.db.select().from(financeOpenItems).all()).toHaveLength(1);

    // Kontakt und Fälligkeit lassen sich überschreiben.
    const g = await withInvoice([attachment(invoiceXml({ iban: null, dueDate: null }))]);
    const other = g.donor;
    const own = unwrap(await createOpenItemFromInvoice(g.deps, g.ctx, { documentId: g.documentId, contactId: other.id, dueOn: '2026-05-15' }));
    expect(own).toMatchObject({ contactId: other.id, dueOn: '2026-05-15' });
    expect(JSON.parse(own.lineTemplate!)).toEqual([{ taxCode: 'standard', contactId: other.id }]);
  });

  it('forbidden, validation, no invoice, and an audit entry without seller, number or iban', async () => {
    const f = await withInvoice([attachment(invoiceXml())]);
    expect(await createOpenItemFromInvoice(f.deps, financeReader(f), { documentId: f.documentId })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.entriesWrite' } });
    expect(await createOpenItemFromInvoice(f.deps, f.ctx, { documentId: f.documentId, dueOn: 'morgen' })).toMatchObject({ ok: false, error: { type: 'validation' } });

    const item = unwrap(await createOpenItemFromInvoice(f.deps, f.ctx, { documentId: f.documentId }));
    const rows = auditRows(f).filter((e) => e.entityId === item.id);
    expect(rows.map((e) => e.action)).toEqual(['finance.openItem.create']);
    const logged = JSON.stringify(auditRows(f));
    for (const secret of ['Tierarztpraxis', 'TM-2026-0042', PAYEE_IBAN, '424242']) expect(logged).not.toContain(secret);

    const none = await withInvoice([]);
    expect(await createOpenItemFromInvoice(none.deps, none.ctx, { documentId: none.documentId })).toMatchObject({ ok: false, error: { type: 'notFound', entity: 'invoice' } });
  });
});

describe('applyInvoiceToDraft', () => {
  it('applies seller, number, contact and tax code to a draft and attaches the document', async () => {
    const f = await withInvoice([attachment(invoiceXml())]);
    const supplier = await supplierWithIban(f);
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -11900, iban: PAYEE_IBAN, date: '2026-04-12' });
    const draft = unwrap(await saveDraft(f.deps, f.ctx, {
      entryDate: '2026-04-12', text: 'Kontoumsatz', moneyLines: [{ accountId: f.bank.id, amountCents: -11900, rawTransactionId: rawId }],
      allocationLines: [
        { categoryId: f.programCosts.id, amountCents: -10000 },
        { categoryId: f.programCosts.id, amountCents: -1900, taxCode: 'reduced', contactId: f.donor.id },
      ],
    }));

    const entry = unwrap(await applyInvoiceToDraft(f.deps, f.ctx, { entryId: draft.id, documentId: f.documentId }));
    expect(entry.text).toBe('Tierarztpraxis Muster Rechnung TM-2026-0042');
    expect(entry.allocationLines).toMatchObject([
      { amountCents: -10000, taxCode: 'standard', contactId: supplier },
      { amountCents: -1900, taxCode: 'reduced', contactId: f.donor.id },
    ]);
    expect(entry.moneyLines).toMatchObject([{ rawTransactionId: rawId, amountCents: -11900 }]);
    expect(entry.vouchers).toMatchObject([{ documentId: f.documentId, revokedAt: null }]);

    // Ein zweites Mal hängt das Dokument nicht noch einmal an.
    const again = unwrap(await applyInvoiceToDraft(f.deps, f.ctx, { entryId: draft.id, documentId: f.documentId }));
    expect(again.vouchers).toHaveLength(1);
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: draft.id })).status).toBe('draft');
  });

  it('shortens a long text to 300 characters and refuses an entry that is not a draft', async () => {
    const f = await withInvoice([attachment(invoiceXml({ seller: 'L'.repeat(320) }))]);
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-04-12', text: 'x', moneyLines: [], allocationLines: [] }));
    expect(unwrap(await applyInvoiceToDraft(f.deps, f.ctx, { entryId: draft.id, documentId: f.documentId })).text).toHaveLength(300);

    const final = await f.finalEntry();
    expect(await applyInvoiceToDraft(f.deps, f.ctx, { entryId: final.id, documentId: f.documentId })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'invoiceNotDraft' } });
  });

  it('forbidden, validation, foreign currency, and audits through the ledger without seller, number or iban', async () => {
    const f = await withInvoice([attachment(invoiceXml())]);
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-04-12', text: 'x', moneyLines: [], allocationLines: [] }));
    expect(await applyInvoiceToDraft(f.deps, financeReader(f), { entryId: draft.id, documentId: f.documentId })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.entriesWrite' } });
    expect(await applyInvoiceToDraft(f.deps, f.ctx, { entryId: draft.id })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await applyInvoiceToDraft(f.deps, f.ctx, { entryId: 'nope', documentId: f.documentId })).toMatchObject({ ok: false, error: { type: 'notFound' } });

    unwrap(await applyInvoiceToDraft(f.deps, f.ctx, { entryId: draft.id, documentId: f.documentId }));
    const actions = auditRows(f).filter((e) => e.entityId === draft.id || String(e.after ?? '').includes(draft.id)).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['finance.entry.draftSave', 'finance.entry.documentAdd']));
    const logged = JSON.stringify(auditRows(f));
    for (const secret of ['Tierarztpraxis', 'TM-2026-0042', PAYEE_IBAN]) expect(logged).not.toContain(secret);

    const chf = await withInvoice([attachment(invoiceXml({ currency: 'CHF' }))]);
    const chfDraft = unwrap(await saveDraft(chf.deps, chf.ctx, { entryDate: '2026-04-12', text: 'x', moneyLines: [], allocationLines: [] }));
    expect(await applyInvoiceToDraft(chf.deps, chf.ctx, { entryId: chfDraft.id, documentId: chf.documentId })).toMatchObject({ ok: false, error: { code: 'invoiceCurrencyUnsupported' } });
  });
});

describe('invoice MCP tools', () => {
  it('registers the four tools with their permission in the description', async () => {
    const tool = (name: string) => FINANCE_MCP_TOOLS.find((t) => t.name === name)!;
    expect(tool('finance_invoice_read').description).toContain('finance.read');
    expect(tool('finance_invoice_proposal').description).toContain('finance.read');
    expect(tool('finance_open_item_from_invoice').description).toContain('finance.entriesWrite');
    expect(tool('finance_invoice_apply_to_draft').description).toContain('finance.entriesWrite');

    const f = await withInvoice([attachment(invoiceXml())]);
    expect(unwrap(await tool('finance_invoice_proposal').handler(f.deps, f.ctx, { documentId: f.documentId }))).toMatchObject({ kind: 'unpaid' });
    expect(unwrap(await tool('finance_open_item_from_invoice').handler(f.deps, f.ctx, { documentId: f.documentId }))).toMatchObject({ kind: 'payable', amountCents: 11900 });
    expect(f.deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.documentId, f.documentId)).all()).toHaveLength(1);
  });
});

import { buildPdfWithAttachments } from '@kompass/core';

/**
 * ZUGFeRD-/Factur-X-Rechnungen von Hand (F5b) — für die Entwicklungsdaten
 * (`seedFinance`), die Dienst-Tests und, davon abgeleitet, die Fixtures der
 * Rechnungs-E2E (`apps/kompass/e2e/fixtures/zugferd/`, Byte-Wächter
 * `tests/e2e-fixtures-zugferd.test.ts`). Muster `camt-fixture.ts`: kein
 * Werkzeug, gleiche Eingabe, gleiche Bytes.
 *
 * Das XML ist eine kleine Cross-Industry-Invoice im Profil EN16931 — nur die
 * Summen, die `parseFacturX` liest, keine Positionen. Erfunden: Lieferanten
 * „Muster“, IBANs mit BLZ 99999999.
 */
export interface InvoiceFixture {
  number?: string;
  /** `YYYYMMDD` (Format 102). */
  issue?: string;
  seller?: string;
  currency?: string;
  /** 380 Rechnung, 381 Gutschrift. */
  typeCode?: string;
  /** Dezimal mit Punkt, etwa `119.00`. */
  grand?: string;
  due?: string;
  taxTotal?: string;
  taxes?: { rate: string; category: string; basis: string; tax: string }[];
  /** `YYYYMMDD`; `null` lässt die Fälligkeit weg. */
  dueDate?: string | null;
  /** `null` lässt die Zahlungsempfänger-IBAN weg. */
  iban?: string | null;
}

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Vorgabe jedes Feldes: die unbezahlte Tierarzt-Rechnung (`VET_INVOICE`). */
export function buildInvoiceXml(o: InvoiceFixture = {}): string {
  const taxes = o.taxes ?? [{ rate: '19.00', category: 'S', basis: '100.00', tax: '19.00' }];
  const dueDate = o.dueDate === undefined ? '20260430' : o.dueDate;
  const iban = o.iban === undefined ? 'DE25999999990000424242' : o.iban;
  const currency = o.currency ?? 'EUR';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${escapeXml(o.number ?? 'TM-2026-0042')}</ram:ID>
    <ram:TypeCode>${o.typeCode ?? '380'}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${o.issue ?? '20260401'}</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>${escapeXml(o.seller ?? 'Tierarztpraxis Muster')}</ram:Name></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Beispielverein e.V.</ram:Name></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${currency}</ram:InvoiceCurrencyCode>
      ${iban ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${iban}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>` : ''}
      ${taxes.map((t) => `<ram:ApplicableTradeTax><ram:CalculatedAmount>${t.tax}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${t.basis}</ram:BasisAmount><ram:CategoryCode>${t.category}</ram:CategoryCode><ram:RateApplicablePercent>${t.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`).join('\n      ')}
      ${dueDate ? `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${dueDate}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>` : ''}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxTotalAmount currencyID="${currency}">${o.taxTotal ?? '19.00'}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${o.grand ?? '119.00'}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${o.due ?? o.grand ?? '119.00'}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

/** Ein PDF mit der Rechnung als Anhang `factur-x.xml` — mehr braucht `readInvoiceFromDocument` nicht. */
export function buildInvoicePdf(o: InvoiceFixture = {}): Uint8Array {
  return buildPdfWithAttachments([{ name: 'factur-x.xml', mimeType: 'text/xml', content: buildInvoiceXml(o) }]);
}

/** Unbezahlt: 100,00 € + 19 %, fällig 30.04.2026 — im Seed ein Finanzbeleg ohne Buchung. */
export const VET_INVOICE = {
  number: 'TM-2026-0042',
  issue: '20260401',
  seller: 'Tierarztpraxis Muster',
  grand: '119.00',
  taxTotal: '19.00',
  taxes: [{ rate: '19.00', category: 'S', basis: '100.00', tax: '19.00' }],
  dueDate: '20260430',
  iban: 'DE25999999990000424242',
} as const satisfies InvoiceFixture;

/**
 * Bezahlt: 35,00 € an die IBAN der Büromaterial-Zeile auf „Importkonto“
 * (Seed, Lauf A: 10.01.2026, −35,00 €) — `invoiceProposal` findet den
 * Kontoumsatz sicher über die IBAN.
 */
export const OFFICE_INVOICE = {
  number: 'BM-7781',
  issue: '20260108',
  seller: 'Bürobedarf Muster GmbH',
  grand: '35.00',
  taxTotal: '5.59',
  taxes: [{ rate: '19.00', category: 'S', basis: '29.41', tax: '5.59' }],
  dueDate: '20260122',
  iban: 'DE12999999990000112233',
} as const satisfies InvoiceFixture;

export const buildVetInvoicePdf = (): Uint8Array => buildInvoicePdf({ ...VET_INVOICE, taxes: [...VET_INVOICE.taxes] });
export const buildOfficeInvoicePdf = (): Uint8Array => buildInvoicePdf({ ...OFFICE_INVOICE, taxes: [...OFFICE_INVOICE.taxes] });

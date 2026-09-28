import { describe, expect, it } from 'vitest';
import { INVOICE_ATTACHMENT_NAMES, isInvoiceAttachmentName, parseFacturX } from '../src/import/zugferd/parse';

const enc = (s: string) => new TextEncoder().encode(s);

const NS = 'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"';

/** Factur-X MINIMUM: nur Kopf und Summen, keine Steueraufschlüsselung, keine Zahlungsangaben. */
const MINIMUM = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice ${NS}>
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:factur-x.eu:1p0:minimum</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>MIN-2026-001</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260315</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>Futterhandel Beispiel KG</ram:Name>
        <ram:PostalTradeAddress><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE999999999</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Beispielverein e.V.</ram:Name></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>42.02</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">7.98</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>50.00</ram:GrandTotalAmount>
        <ram:DuePayableAmount>50.00</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;

/** EN16931 (COMFORT): zwei Steuersätze, Zahlungsempfänger-IBAN, Fälligkeit, Verwendungszweck, eine Anzahlung. */
const EN16931 = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice ${NS}>
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>TM-2026-0042</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260401</udt:DateTimeString></ram:IssueDateTime>
    <ram:IncludedNote><ram:Content>Vielen Dank für Ihren Auftrag.</ram:Content></ram:IncludedNote>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>1</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>19</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>100.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>Tierarztpraxis Muster</ram:Name>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">99/999/99999</ram:ID></ram:SpecifiedTaxRegistration>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE123456789</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Beispielverein e.V.</ram:Name></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>TM-2026-0042 Kd 17</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>de85 9999 9999 9999 9999 99</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>19.00</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>100.00</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>19.00</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>3.50</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>50.00</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>7</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms>
        <ram:Description>Zahlbar innerhalb 30 Tagen</ram:Description>
        <ram:DueDateDateTime><udt:DateTimeString format="102">20260430</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>150.00</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>150.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">22.50</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>172.50</ram:GrandTotalAmount>
        <ram:TotalPrepaidAmount>20.00</ram:TotalPrepaidAmount>
        <ram:DuePayableAmount>152.50</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;

/** XRechnung als CII: eigenes Profil, Leitweg-ID, Kontakt — und hier andere Präfixe, ein Standard-Namensraum fürs Wurzelelement. */
const XRECHNUNG = `<?xml version="1.0" encoding="UTF-8"?>
<CrossIndustryInvoice xmlns="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:a="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:u="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <ExchangedDocumentContext>
    <a:BusinessProcessSpecifiedDocumentContextParameter><a:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</a:ID></a:BusinessProcessSpecifiedDocumentContextParameter>
    <a:GuidelineSpecifiedDocumentContextParameter><a:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</a:ID></a:GuidelineSpecifiedDocumentContextParameter>
  </ExchangedDocumentContext>
  <ExchangedDocument>
    <a:ID>XR-77</a:ID>
    <a:TypeCode>380</a:TypeCode>
    <a:IssueDateTime><u:DateTimeString format="102">20261231</u:DateTimeString></a:IssueDateTime>
  </ExchangedDocument>
  <SupplyChainTradeTransaction>
    <a:ApplicableHeaderTradeAgreement>
      <a:BuyerReference>04011000-12345-67</a:BuyerReference>
      <a:SellerTradeParty>
        <a:Name>Druckerei Beispiel &amp; Söhne</a:Name>
        <a:DefinedTradeContact><a:PersonName>Erika Beispiel</a:PersonName></a:DefinedTradeContact>
      </a:SellerTradeParty>
      <a:BuyerTradeParty><a:Name>Beispielverein e.V.</a:Name></a:BuyerTradeParty>
    </a:ApplicableHeaderTradeAgreement>
    <a:ApplicableHeaderTradeDelivery/>
    <a:ApplicableHeaderTradeSettlement>
      <a:InvoiceCurrencyCode>EUR</a:InvoiceCurrencyCode>
      <a:SpecifiedTradeSettlementPaymentMeans><a:TypeCode>30</a:TypeCode></a:SpecifiedTradeSettlementPaymentMeans>
      <a:SpecifiedTradeSettlementPaymentMeans>
        <a:TypeCode>58</a:TypeCode>
        <a:PayeePartyCreditorFinancialAccount><a:IBANID>DE39999999990012345678</a:IBANID></a:PayeePartyCreditorFinancialAccount>
      </a:SpecifiedTradeSettlementPaymentMeans>
      <a:ApplicableTradeTax>
        <a:CalculatedAmount>0.00</a:CalculatedAmount>
        <a:TypeCode>VAT</a:TypeCode>
        <a:ExemptionReason>Steuerfrei</a:ExemptionReason>
        <a:BasisAmount>1234.5</a:BasisAmount>
        <a:CategoryCode>E</a:CategoryCode>
        <a:RateApplicablePercent>0</a:RateApplicablePercent>
      </a:ApplicableTradeTax>
      <a:SpecifiedTradeSettlementHeaderMonetarySummation>
        <a:LineTotalAmount>1234.50</a:LineTotalAmount>
        <a:TaxBasisTotalAmount>1234.50</a:TaxBasisTotalAmount>
        <a:TaxTotalAmount currencyID="EUR">0.00</a:TaxTotalAmount>
        <a:GrandTotalAmount>1234.50</a:GrandTotalAmount>
        <a:DuePayableAmount>1234.50</a:DuePayableAmount>
      </a:SpecifiedTradeSettlementHeaderMonetarySummation>
    </a:ApplicableHeaderTradeSettlement>
  </SupplyChainTradeTransaction>
</CrossIndustryInvoice>
`;

const CREDIT_NOTE = EN16931.replace('<ram:TypeCode>380</ram:TypeCode>', '<ram:TypeCode>381</ram:TypeCode>');
const FOREIGN_CURRENCY = MINIMUM.replace('<ram:InvoiceCurrencyCode>EUR', '<ram:InvoiceCurrencyCode>CHF')
  .replace('currencyID="EUR">7.98', 'currencyID="CHF">7.98</ram:TaxTotalAmount><ram:TaxTotalAmount currencyID="EUR">8.30');
const FOREIGN_XML = `<?xml version="1.0"?>\n<rsm:CrossIndustryInvoice xmlns:rsm="urn:example:not-cii"><rsm:ExchangedDocument/></rsm:CrossIndustryInvoice>`;
const OTHER_ROOT = `<?xml version="1.0"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt/></Document>`;
const DOCTYPE = MINIMUM.replace('<rsm:CrossIndustryInvoice', '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]>\n<rsm:CrossIndustryInvoice');
const NO_GRAND_TOTAL = MINIMUM.replace('<ram:GrandTotalAmount>50.00</ram:GrandTotalAmount>', '');

function parsed(xml: string) {
  const result = parseFacturX(enc(xml));
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.invoice;
}

describe('parseFacturX', () => {
  it('reads the minimum profile totals and dates', () => {
    expect(parsed(MINIMUM)).toEqual({
      profile: 'urn:factur-x.eu:1p0:minimum',
      invoiceNumber: 'MIN-2026-001',
      issueDate: '2026-03-15',
      typeCode: '380',
      sellerName: 'Futterhandel Beispiel KG',
      sellerVatId: 'DE999999999',
      buyerName: 'Beispielverein e.V.',
      currency: 'EUR',
      grandTotalCents: 5000,
      duePayableCents: 5000,
      taxTotalCents: 798,
      taxes: [],
      dueDate: null,
      paymentReference: null,
      payeeIban: null,
    });
  });

  it('reads two tax rates and the payee iban of an EN16931 invoice', () => {
    const invoice = parsed(EN16931);

    expect(invoice).toMatchObject({
      profile: 'urn:cen.eu:en16931:2017',
      invoiceNumber: 'TM-2026-0042',
      issueDate: '2026-04-01',
      sellerName: 'Tierarztpraxis Muster',
      sellerVatId: 'DE123456789',
      grandTotalCents: 17250,
      duePayableCents: 15250,
      taxTotalCents: 2250,
      dueDate: '2026-04-30',
      paymentReference: 'TM-2026-0042 Kd 17',
      payeeIban: 'DE85999999999999999999',
    });
    // Nur die Kopfsteuern, nicht die der Positionen.
    expect(invoice.taxes).toEqual([
      { ratePercent: 19, categoryCode: 'S', basisCents: 10000, taxCents: 1900 },
      { ratePercent: 7, categoryCode: 'S', basisCents: 5000, taxCents: 350 },
    ]);
  });

  it('reads an XRechnung in CII syntax with other prefixes, an exempt tax and the iban of the second means', () => {
    const invoice = parsed(XRECHNUNG);

    expect(invoice).toMatchObject({
      profile: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
      invoiceNumber: 'XR-77',
      issueDate: '2026-12-31',
      sellerName: 'Druckerei Beispiel & Söhne',
      sellerVatId: null,
      grandTotalCents: 123450,
      duePayableCents: 123450,
      taxTotalCents: 0,
      payeeIban: 'DE39999999990012345678',
    });
    expect(invoice.taxes).toEqual([{ ratePercent: 0, categoryCode: 'E', basisCents: 123450, taxCents: 0 }]);
  });

  it('negates a credit note', () => {
    const invoice = parsed(CREDIT_NOTE);

    expect(invoice).toMatchObject({ typeCode: '381', grandTotalCents: -17250, duePayableCents: -15250, taxTotalCents: -2250 });
    expect(invoice.taxes.map((t) => [t.basisCents, t.taxCents])).toEqual([[-10000, -1900], [-5000, -350]]);
  });

  it('reads a foreign currency as it is and takes the tax total in the invoice currency', () => {
    expect(parsed(FOREIGN_CURRENCY)).toMatchObject({ currency: 'CHF', grandTotalCents: 5000, taxTotalCents: 798 });
  });

  it('turns decimal strings into cents without floating point', () => {
    // 0.29 * 100 ergibt in Gleitkomma 28.999999999999996; 4.35 * 100 = 434.99999999999994.
    const invoice = parsed(
      MINIMUM.replace('<ram:GrandTotalAmount>50.00', '<ram:GrandTotalAmount>4.35')
        .replace('<ram:DuePayableAmount>50.00', '<ram:DuePayableAmount>0.29')
        .replace('>7.98<', '>1.005<'),
    );
    expect([invoice.grandTotalCents, invoice.duePayableCents, invoice.taxTotalCents]).toEqual([435, 29, 101]);
  });

  it('refuses xml that is not a cross industry invoice', () => {
    expect(parseFacturX(enc(FOREIGN_XML))).toEqual({ ok: false, code: 'notAnInvoice' });
    expect(parseFacturX(enc(OTHER_ROOT))).toEqual({ ok: false, code: 'notAnInvoice' });
    expect(parseFacturX(enc('<a/>'))).toEqual({ ok: false, code: 'notAnInvoice' });
    expect(parseFacturX(enc('keine XML-Datei'))).toEqual({ ok: false, code: 'xmlInvalid' });
    expect(parseFacturX(enc('<a><b></a>'))).toEqual({ ok: false, code: 'xmlInvalid' });
  });

  it('refuses a doctype and an oversized file', () => {
    const doctype = parseFacturX(enc(DOCTYPE));
    expect(doctype).toEqual({ ok: false, code: 'doctypeRefused' });
    expect(JSON.stringify(doctype)).not.toContain('passwd');

    const bytes = enc(MINIMUM);
    expect(parseFacturX(bytes, { maxBytes: bytes.byteLength - 1 })).toEqual({ ok: false, code: 'xmlTooLarge' });
    expect(parseFacturX(bytes, { maxBytes: bytes.byteLength }).ok).toBe(true);
  });

  it('names the missing field', () => {
    expect(parseFacturX(enc(NO_GRAND_TOTAL))).toEqual({ ok: false, code: 'missingField', field: 'GrandTotalAmount' });
    expect(parseFacturX(enc(MINIMUM.replace('<ram:ID>MIN-2026-001</ram:ID>', '')))).toEqual({ ok: false, code: 'missingField', field: 'ExchangedDocument/ID' });
    expect(parseFacturX(enc(MINIMUM.replace('20260315', '20260231')))).toEqual({ ok: false, code: 'missingField', field: 'IssueDateTime' });
    expect(parseFacturX(enc(MINIMUM.replace('<ram:Name>Futterhandel Beispiel KG</ram:Name>', '')))).toEqual({ ok: false, code: 'missingField', field: 'SellerTradeParty/Name' });
    expect(parseFacturX(enc(MINIMUM.replace('<ram:GrandTotalAmount>50.00', '<ram:GrandTotalAmount>50,00')))).toEqual({ ok: false, code: 'missingField', field: 'GrandTotalAmount' });
  });
});

describe('invoice attachment names', () => {
  it('knows the four names, compared without case, and nothing with a path in front', () => {
    expect(INVOICE_ATTACHMENT_NAMES).toEqual(['factur-x.xml', 'zugferd-invoice.xml', 'ZUGFeRD-invoice.xml', 'xrechnung.xml']);
    for (const name of ['factur-x.xml', 'FACTUR-X.XML', 'zugferd-invoice.xml', 'ZUGFeRD-invoice.xml', 'XRechnung.xml']) {
      expect(isInvoiceAttachmentName(name), name).toBe(true);
    }
    for (const name of ['../factur-x.xml', 'factur-x.xml.exe', 'rechnung.xml', '']) {
      expect(isInvoiceAttachmentName(name), name).toBe(false);
    }
  });
});

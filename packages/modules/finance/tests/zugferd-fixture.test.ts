import { describe, expect, it } from 'vitest';
import { parseFacturX } from '../src/import/zugferd/parse';
import { buildInvoicePdf, buildInvoiceXml, buildOfficeInvoicePdf, buildVetInvoicePdf, OFFICE_INVOICE, VET_INVOICE } from '../src/import/zugferd-fixture';

const xmlOf = (pdf: Uint8Array): Uint8Array => {
  // Der Anhang steht unkomprimiert im Stream — für den Test genügt es, seine Bytes herauszuschneiden.
  const text = new TextDecoder('latin1').decode(pdf);
  const start = text.indexOf('<?xml');
  const end = text.indexOf('</rsm:CrossIndustryInvoice>') + '</rsm:CrossIndustryInvoice>'.length;
  return pdf.slice(start, end);
};

describe('zugferd-fixture', () => {
  it('builds xml that parseFacturX reads with the chosen fields', () => {
    const parsed = parseFacturX(new TextEncoder().encode(buildInvoiceXml({ number: 'X-1', grand: '50.00', taxTotal: '7.98', taxes: [{ rate: '19.00', category: 'S', basis: '42.02', tax: '7.98' }] })));
    expect(parsed).toMatchObject({ ok: true, invoice: { invoiceNumber: 'X-1', grandTotalCents: 5000, taxTotalCents: 798 } });
  });

  it('builds the unpaid vet invoice of the seed: 119,00 € with 19 %, due 2026-04-30, payee iban with BLZ 99999999', () => {
    const parsed = parseFacturX(xmlOf(buildVetInvoicePdf()));
    expect(parsed).toMatchObject({
      ok: true,
      invoice: { sellerName: 'Tierarztpraxis Muster', invoiceNumber: 'TM-2026-0042', issueDate: '2026-04-01', grandTotalCents: 11900, taxTotalCents: 1900, dueDate: '2026-04-30', currency: 'EUR' },
    });
    if (parsed.ok) expect(parsed.invoice.payeeIban).toMatch(/^DE\d{2}99999999\d{10}$/);
    expect(VET_INVOICE.number).toBe('TM-2026-0042');
  });

  it('builds the paid office invoice of the seed: 35,00 € to the iban of the office-supply line on the import account', () => {
    const parsed = parseFacturX(xmlOf(buildOfficeInvoicePdf()));
    expect(parsed).toMatchObject({
      ok: true,
      invoice: { sellerName: 'Bürobedarf Muster GmbH', invoiceNumber: 'BM-7781', issueDate: '2026-01-08', grandTotalCents: 3500, taxTotalCents: 559, payeeIban: 'DE12999999990000112233' },
    });
    expect(OFFICE_INVOICE.number).toBe('BM-7781');
  });

  it('is deterministic — same input, same bytes, a pdf with the invoice attached as factur-x.xml', () => {
    expect(buildOfficeInvoicePdf()).toEqual(buildOfficeInvoicePdf());
    const text = new TextDecoder('latin1').decode(buildInvoicePdf(VET_INVOICE));
    expect(text.startsWith('%PDF-1.7')).toBe(true);
    expect(text).toContain('/EmbeddedFiles');
    expect(text).toContain('(factur-x.xml)');
  });
});

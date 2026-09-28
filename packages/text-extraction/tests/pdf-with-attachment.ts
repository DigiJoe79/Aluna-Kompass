import { buildPdfWithAttachments, type PdfAttachment } from '@kompass/core';

/**
 * Der Bauhelfer liegt im Kern (`packages/core/src/text/pdf-with-attachments.ts`),
 * weil auch das Finanzmodul ihn braucht; hier bleibt nur der Inhalt der
 * committeten Fixture `fixtures/mit-anhang.pdf`.
 */
export { buildPdfWithAttachments };
export type Attachment = PdfAttachment;

/** Inhalt der committeten Fixture `fixtures/mit-anhang.pdf`. */
export const FIXTURE_ATTACHMENTS: readonly Attachment[] = [
  {
    name: 'factur-x.xml',
    mimeType: 'text/xml',
    content: '<?xml version="1.0" encoding="UTF-8"?>\n<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"/>\n',
  },
  // Ein Name, der als Pfad aus dem Temp-Verzeichnis herausführen würde.
  { name: '../evil.xml', mimeType: 'text/xml', content: '<evil/>\n' },
];

export const buildFixturePdf = (): Uint8Array => buildPdfWithAttachments(FIXTURE_ATTACHMENTS);

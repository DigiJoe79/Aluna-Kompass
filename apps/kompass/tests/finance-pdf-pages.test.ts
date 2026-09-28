import { describe, expect, it } from 'vitest';
import { countPdfPages } from '../src/lib/finance/pdf-pages';

const pdf = (body: string) => new TextEncoder().encode(`%PDF-1.4\n${body}\n%%EOF\n`);

/** Board-Fund F8a (Design-Nachtrag Phase 4): die Dateizeile eines Belegs nennt die Seitenzahl — „1 Seite · 184 KB“. */
describe('countPdfPages', () => {
  it('counts page objects, never the page tree', () => {
    expect(countPdfPages(pdf('1 0 obj<</Type /Pages /Kids [2 0 R 3 0 R] /Count 2>>endobj 2 0 obj<</Type /Page>>endobj 3 0 obj<</Type/Page/Parent 1 0 R>>endobj'))).toBe(2);
    expect(countPdfPages(pdf('1 0 obj<</Type /Pages /Count 1>>endobj 2 0 obj<</Type /Page >>endobj'))).toBe(1);
  });

  it('knows nothing about a file that is no PDF or has no readable page object (compressed object streams)', () => {
    expect(countPdfPages(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(countPdfPages(pdf('1 0 obj<</Type/Catalog>>endobj'))).toBeNull();
  });
});

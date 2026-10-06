import { readTextLayer } from '@kompass/text-extraction';
import { describe, expect, it } from 'vitest';
import { receiptLines, receiptPdf } from '../src/seed-pdf';

const BON = {
  shop: ['Papierhaus Lindner', 'Marktstraße 14', '12345 Musterstadt'],
  date: '2026-06-05',
  time: '10:42',
  receiptNo: '4711-0815',
  payment: 'EC-KARTE' as const,
  items: [{ text: 'Flipchartpapier 2 Blöcke', cents: 1190 }, { text: 'Klebeband transparent', cents: 249 }, { text: 'Namensschilder 50 St.', cents: 451 }],
};

describe('receiptPdf', () => {
  it('prints a till receipt: shop, date, items, total and VAT, each line 34 characters', () => {
    const lines = receiptLines(BON);
    expect(lines.filter((l) => l.length > 0).every((l) => l.length === 34)).toBe(true);
    expect(lines).toContain('05.06.2026                   10:42');
    expect(lines.some((l) => l.startsWith('SUMME EUR') && l.endsWith('18,90'))).toBe(true);
    expect(lines.some((l) => l.startsWith('A 19 % MwSt. enthalten') && l.endsWith('3,02'))).toBe(true);
  });

  it('prints reduced-rate items with B and lists each rate it uses (Futter/Stroh 7 %, release-0.2.7 Befund 10)', () => {
    const lines = receiptLines({ ...BON, items: [{ text: 'Schlafbox', cents: 11900 }, { text: 'Strohballen', cents: 10700, vat: 7 }] });
    expect(lines.some((l) => l.startsWith('Schlafbox') && l.endsWith('119,00 A'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Strohballen') && l.endsWith('107,00 B'))).toBe(true);
    expect(lines.some((l) => l.startsWith('A 19 % MwSt. enthalten') && l.endsWith('19,00'))).toBe(true);
    expect(lines.some((l) => l.startsWith('B 7 % MwSt. enthalten') && l.endsWith('7,00'))).toBe(true);
    expect(receiptLines(BON).some((l) => l.startsWith('B 7 %'))).toBe(false);
  });

  it('is a PDF with a readable text layer', async () => {
    const pages = await readTextLayer(receiptPdf(BON), 30_000);
    expect(pages.join(' ')).toContain('Papierhaus Lindner');
  });
});

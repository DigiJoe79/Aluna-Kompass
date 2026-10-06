import { readFileSync } from 'node:fs';
import path from 'node:path';
import { seedStoryYear } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { associationDay } from '../e2e/association-day';
import { shiftFixture, shiftYears, STORY_YEAR } from '../e2e/story-year';

const FIXTURES = path.resolve(import.meta.dirname, '../e2e/fixtures');

describe('e2e/story-year', () => {
  it('uses the same story year as the seed', () => {
    expect(STORY_YEAR).toBe(seedStoryYear(associationDay()));
  });

  it('shifts years standing alone and leaves longer digit runs alone', () => {
    expect(shiftYears('RE-2026-041 · 01.04.2026 · 2025-05-02 · Veranlagungszeitraum 2022–2024', 1)).toBe('RE-2027-041 · 01.04.2027 · 2026-05-02 · Veranlagungszeitraum 2023–2025');
    expect(shiftYears('DE60999999990201051234 · 20260108 · 2036-01-15 · IMP-0001', 1)).toBe('DE60999999990201051234 · 20260108 · 2036-01-15 · IMP-0001');
    expect(shiftYears('01.04.2026', 0)).toBe('01.04.2026');
  });

  it('shifts fixture files without changing their length — CSV byte for byte, in the PDF only the invoice dates', () => {
    const csv = readFileSync(path.join(FIXTURES, 'csv/zweitbank.csv'));
    const movedCsv = shiftFixture(csv, '.csv', 1);
    expect(movedCsv.length).toBe(csv.length);
    expect(movedCsv.toString('latin1')).toContain('Mitgliedsbeitrag 2027');
    expect(movedCsv.toString('latin1')).not.toMatch(/(?<!\d)2026(?!\d)/);

    const pdf = readFileSync(path.join(FIXTURES, 'zugferd/rechnung-buerobedarf.pdf'));
    const movedPdf = shiftFixture(pdf, '.pdf', 1);
    expect(movedPdf.length).toBe(pdf.length);
    expect(movedPdf.toString('latin1')).toContain('>20270108<');
    const withoutDates = (b: Buffer) => b.toString('latin1').replace(/>202[67]01(08|22)</g, '');
    expect(withoutDates(movedPdf)).toBe(withoutDates(pdf));
  });
});

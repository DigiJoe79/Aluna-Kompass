import { describe, expect, it } from 'vitest';
import { ocrLanguageName } from '@/lib/ocr-language';

/** 11-1 C36: OCR-Sprachen mit Klarnamen statt „deu“, „eng“; Codes wie `chi_sim` mit Rückfall. */
describe('ocrLanguageName', () => {
  it('names the three-letter codes of Tesseract', () => {
    expect(ocrLanguageName('deu', 'de')).toBe('Deutsch');
    expect(ocrLanguageName('eng', 'de')).toBe('Englisch');
  });
  it('falls back to the base language plus the code for variants, and to the code itself', () => {
    expect(ocrLanguageName('chi_sim', 'de')).toBe('Chinesisch (chi_sim)');
    expect(ocrLanguageName('osd', 'de')).toBe('osd');
  });
});

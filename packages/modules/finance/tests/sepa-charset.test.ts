import { describe, expect, it } from 'vitest';
import { sepaText } from '../src/direct-debit/charset';

/** Plan L2 Task 3 — Zeichensatz der Deutschen Kreditwirtschaft für SEPA-Dateien. */
describe('sepaText', () => {
  it('keeps the allowed characters and the umlauts', () => {
    expect(sepaText("Müller-Lüdenscheidt (Söhne) / Groß ÄÖÜ äöü ß 0-9 ?:.,'+", 140)).toBe("Müller-Lüdenscheidt (Söhne) / Groß ÄÖÜ äöü ß 0-9 ?:.,'+");
  });

  it('replaces & with +, strips accents, everything else becomes a space', () => {
    expect(sepaText('Müller & Söhne', 70)).toBe('Müller + Söhne');
    expect(sepaText('José Núñez-Çelik', 70)).toBe('Jose Nunez-Celik');
    expect(sepaText('Łukasz Østergård', 70)).toBe('Lukasz Ostergard');
    expect(sepaText('Spende "Sommerfest" 50€ @ Verein_eins; ok', 140)).toBe('Spende Sommerfest 50 Verein eins ok');
  });

  it('collapses spaces, trims and cuts to the maximum length', () => {
    expect(sepaText('  Erika   Beispiel  ', 70)).toBe('Erika Beispiel');
    expect(sepaText('x'.repeat(80), 70)).toHaveLength(70);
    expect(sepaText(`${'a'.repeat(69)} b`, 70)).toBe('a'.repeat(69));
    expect(sepaText('ü'.repeat(80), 70)).toBe('ü'.repeat(70));
  });
});

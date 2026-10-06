import { describe, expect, it } from 'vitest';
import { SLUG } from '../src/service';
import { animalSlug } from '../src/slug';

const ID = '01M3FPWPWAM4CCFPW048GAYEH3';

describe('animalSlug', () => {
  it('is the name in ASCII plus the last four characters of the id, lower case', () => {
    expect(animalSlug('Luna', ID)).toBe('luna-yeh3');
    expect(animalSlug('Tom', '01M45ZZNA2RMS0F9MW43BSY2AG')).toBe('tom-y2ag');
  });

  it('spells umlauts out and drops other accents (Review Focus 3)', () => {
    expect(animalSlug('Bärbel Ömer', ID)).toBe('baerbel-oemer-yeh3');
    expect(animalSlug('Süß', ID)).toBe('suess-yeh3');
    expect(animalSlug('Nerón', ID)).toBe('neron-yeh3');
    expect(animalSlug('Brașov', ID)).toBe('brasov-yeh3');
  });

  it('turns everything else into single dashes and trims them', () => {
    expect(animalSlug('  Luna (E)  ', ID)).toBe('luna-e-yeh3');
    expect(animalSlug('Mr. Bean -- 2', ID)).toBe('mr-bean-2-yeh3');
  });

  it('is the id part alone when the name gives nothing, and caps the name part at 60', () => {
    expect(animalSlug('???', ID)).toBe('yeh3');
    expect(animalSlug('🐶', ID)).toBe('yeh3');
    const long = animalSlug('a'.repeat(80), ID);
    expect(long).toBe(`${'a'.repeat(60)}-yeh3`);
  });

  it('takes a longer id part on request', () => {
    expect(animalSlug('Luna', ID, 6)).toBe('luna-gayeh3');
  });

  it('always matches the slug pattern', () => {
    for (const name of ['Luna', '???', 'a'.repeat(80), 'Ölf-', '-x-', 'Ünal Çelik']) {
      // Ein langer Name mit der vollen ID (26) überschritte die 81 Zeichen des Musters; das braucht die Kollisionsfolge 4, 6, 8 nie.
      for (const length of name.length > 40 ? [4, 6, 8] : [4, 6, 8, 26]) expect(animalSlug(name, ID, length)).toMatch(SLUG);
    }
  });
});

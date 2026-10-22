import { describe, expect, it } from 'vitest';
import { aiKindOf, aiLabel, aiMark, type AiLabeling } from '../src/lib/ai-label';
import type { SiteContent } from '../src/lib/content';

const content = { assets: [{ id: 'bild', aiKind: 'edited' }] } as unknown as SiteContent;
const onlyGerman = { mark: { de: 'M-erstellt' }, editedLabel: { de: 'L-bearbeitet' }, generatedLabel: { de: 'L-erstellt' } } as unknown as AiLabeling;

describe('Bildkennzeichnung im Grund-Template', () => {
  it('gibt einem Bildausschnitt die Art seines Ursprungs', () => {
    expect(aiKindOf(content, 'bild~0_0_5000_5000')).toBe('edited');
    expect(aiKindOf(content, 'anderes')).toBeNull();
  });

  it('fällt bei fehlender Übersetzung auf die Vorgabesprache zurück', () => {
    expect(aiMark(onlyGerman, 'en' as never)).toBe('M-erstellt');
    expect(aiLabel(onlyGerman, 'edited', 'en' as never)).toBe('L-bearbeitet');
  });

  it('aiMark picks the mark by kind and falls back to mark without editedMark', () => {
    const both = { ...onlyGerman, editedMark: { de: 'M-bearbeitet', en: 'M-edited' } } as AiLabeling;
    expect(aiMark(both, 'de' as never, 'edited')).toBe('M-bearbeitet');
    expect(aiMark(both, 'en' as never, 'edited')).toBe('M-edited');
    expect(aiMark(both, 'de' as never, 'generated')).toBe('M-erstellt');
    expect(aiMark(both, 'de' as never)).toBe('M-erstellt');
    // Ältere Sicht ohne editedMark, oder leer: Marke der erstellten Bilder statt leerem Text.
    expect(aiMark(onlyGerman, 'de' as never, 'edited')).toBe('M-erstellt');
    expect(aiMark({ ...onlyGerman, editedMark: { de: '' } } as AiLabeling, 'de' as never, 'edited')).toBe('M-erstellt');
  });
});

import { parseHandbookIndex } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { overviewChapters } from '@/lib/handbook-overview';

const INDEX = `- Einstieg
  - [Anmelden](einstieg/anmelden.md)
- [Startseite](startseite.md)
- [Tiere](tiere.md)
- [Vorschläge prüfen](tiere-vorschlaege.md)
- Akte
  - [Post ablegen](akte/post-ablegen.md)
- [Profil](profil.md)
`;

describe('Übersicht des Handbuchs (Runde 3, 009)', () => {
  const chapters = overviewChapters(parseHandbookIndex(INDEX), 'Weitere Bereiche');

  it('eine Einzelseite, die eine andere fortsetzt (tiere-…), wird deren Gruppe', () => {
    expect(chapters.find((c) => c.title === 'Tiere')?.pages.map((p) => p.title)).toEqual(['Tiere', 'Vorschläge prüfen']);
  });

  it('die übrigen Einzelseiten stehen unter „Weitere Bereiche“ am Ende, Gruppen in ihrer Reihenfolge', () => {
    expect(chapters.map((c) => c.title)).toEqual(['Einstieg', 'Tiere', 'Akte', 'Weitere Bereiche']);
    expect(chapters.at(-1)?.pages.map((p) => p.doc)).toEqual(['startseite', 'profil']);
  });
});

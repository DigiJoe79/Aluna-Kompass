import { describe, expect, it } from 'vitest';
import { collectTranslationGaps, findBlockedTerms } from '../src';

describe('findBlockedTerms', () => {
  it('finds terms case-insensitively in nested values and filenames with a path', () => {
    const content = { pages: [{ key: 'partners', body: { de: 'Der Shelter von Maria Popescu.', en: '' } }], team: [{ name: 'Nicole' }] };
    const hits = findBlockedTerms(content, ['maria popescu', 'geheim'], ['foto-Maria-Popescu-1.jpg', 'hund.jpg']);
    expect(hits).toEqual([
      { path: 'pages[0].body.de', term: 'maria popescu', excerpt: expect.stringContaining('Maria Popescu') },
      { path: 'files/foto-Maria-Popescu-1.jpg', term: 'maria popescu', excerpt: 'foto-Maria-Popescu-1.jpg' },
    ]);
    expect(findBlockedTerms(content, [])).toEqual([]);
  });
});

describe('collectTranslationGaps', () => {
  it('reports localized fields with de but no en, identified by key/slug/id', () => {
    const content = {
      pages: [{ key: 'help', title: { de: 'Helfen', en: '' }, lede: { de: 'x', en: 'y' } }],
      articles: [{ slug: 'transport', body: { de: 'x', en: '' }, title: { de: '', en: '' } }],
      team: [{ id: 'T1', position: { de: 'Vorsitz', en: '' }, name: 'N' }],
    };
    expect(collectTranslationGaps(content)).toEqual([
      { collection: 'pages', id: 'help', field: 'title' },
      { collection: 'articles', id: 'transport', field: 'body' },
      { collection: 'team', id: 'T1', field: 'position' },
    ]);
  });
});

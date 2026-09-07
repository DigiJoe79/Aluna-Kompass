import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asset, defineTemplate, list, markdown, number, select, text } from '../src';

const template = defineTemplate({
  name: 'Verein Basis',
  locales: ['de', 'en'],
  variables: { claim: text({ max: 120, localized: true, label: 'Claim' }), members: number({ min: 0, label: 'Mitglieder' }) },
  collections: {
    articles: { label: 'Artikel', slug: true, publishable: true, fields: { title: text({ localized: true, label: 'Titel' }), body: markdown({ localized: true, label: 'Text' }) } },
    team: { label: 'Team', sortable: true, max: 30, fields: { name: text({ label: 'Name' }), photo: asset({ label: 'Foto' }) } },
  },
  uses: ['animals'],
});

describe('defineTemplate', () => {
  it('keeps what it was given and defaults the collection traits to false', () => {
    expect(template.name).toBe('Verein Basis');
    expect(template.locales).toEqual(['de', 'en']);
    expect(template.uses).toEqual(['animals']);
    expect(template.collections.articles!.slug).toBe(true);
    expect(template.collections.articles!.sortable).toBe(false);
    expect(template.collections.team!.publishable).toBe(false);
    expect(template.collections.team!.max).toBe(30);
  });

  it('builds zod schemas that carry their widget and label', () => {
    const claim = z.toJSONSchema(template.variables.claim!, { io: 'input' }) as { widget?: string; label?: string; locales?: boolean };
    expect(claim.widget).toBe('localized');
    expect(claim.label).toBe('Claim');
    const photo = z.toJSONSchema(template.collections.team!.fields.photo!, { io: 'input' }) as { widget?: string };
    expect(photo.widget).toBe('asset');
  });

  it('rejects a template without locales, with an unusable name or a bad collection key', () => {
    expect(() => defineTemplate({ name: 'X', locales: [], variables: {}, collections: {} })).toThrow(/locale/i);
    expect(() => defineTemplate({ name: '', locales: ['de'], variables: {}, collections: {} })).toThrow(/name/i);
    expect(() => defineTemplate({ name: 'X', locales: ['de'], variables: {}, collections: { 'Not Ok': { label: 'x', fields: {} } } })).toThrow(/key/i);
  });

  it('rejects a locale code the core would not accept', () => {
    expect(() => defineTemplate({ name: 'X', locales: ['DE'], variables: {}, collections: {} })).toThrow(/locale/i);
  });

  // Ohne diese Angabe liest der Resync eine Umbenennung als „entfällt plus neu"
  // und der Inhalt des Feldes geht verloren.
  it('carries renamedFrom into the schema, for every field helper', () => {
    const cases = {
      text: text({ label: 'A', renamedFrom: 'alt' }),
      localized: text({ label: 'A', localized: true, renamedFrom: 'alt' }),
      markdown: markdown({ label: 'A', renamedFrom: 'alt' }),
      number: number({ label: 'A', renamedFrom: 'alt' }),
      asset: asset({ label: 'A', renamedFrom: 'alt' }),
      select: select(['a', 'b'], { label: 'A', renamedFrom: 'alt' }),
      list: list(text(), { label: 'A', renamedFrom: 'alt' }),
    };
    for (const [name, field] of Object.entries(cases)) {
      const json = z.toJSONSchema(field as never, { io: 'input' }) as { renamedFrom?: string };
      expect(json.renamedFrom, `${name} verliert renamedFrom`).toBe('alt');
    }
  });

  it('leaves renamedFrom out where it was not given', () => {
    expect(z.toJSONSchema(text({ label: 'A' }) as never, { io: 'input' })).not.toHaveProperty('renamedFrom');
  });
});

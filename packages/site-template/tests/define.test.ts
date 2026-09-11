import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asset, date, defineTemplate, list, markdown, number, objectList, select, text } from '../src';

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

  // Ohne diese Angabe liest der Resync eine Umbenennung als „entfällt plus neu“
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

  it('offers a date field the renderer recognises', () => {
    const json = z.toJSONSchema(date({ label: 'Erteilt am' }) as never, { io: 'input' }) as { format?: string; widget?: string; label?: string };
    expect(json.format).toBe('date');
    expect(json.widget).toBe('date');
    expect(json.label).toBe('Erteilt am');
    expect((date() as never as { safeParse: (v: unknown) => { success: boolean } }).safeParse('2026-09-07').success).toBe(true);
    expect((date() as never as { safeParse: (v: unknown) => { success: boolean } }).safeParse('07.09.2026').success).toBe(false);
  });

  it('offers a list of objects, each with its own fields', () => {
    const links = objectList({ label: 'Social-Media-Links', max: 10, fields: { label: text({ label: 'Name' }), href: text({ label: 'Adresse' }) } });
    const json = z.toJSONSchema(links as never, { io: 'input' }) as { widget?: string; maxItems?: number; items?: { properties?: Record<string, { widget?: string; label?: string }> } };
    expect(json.widget).toBe('objectList');
    expect(json.maxItems).toBe(10);
    expect(Object.keys(json.items?.properties ?? {})).toEqual(['label', 'href']);
    expect(json.items?.properties?.href?.label).toBe('Adresse');
  });

  it('validates the entries of an object list', () => {
    const links = objectList({ label: 'L', fields: { label: text({ max: 4 }), href: text() } }) as never as { safeParse: (v: unknown) => { success: boolean } };
    expect(links.safeParse([{ label: 'kurz', href: 'https://example.org' }]).success).toBe(true);
    expect(links.safeParse([{ label: 'viel zu lang', href: 'x' }]).success).toBe(false);
  });
});

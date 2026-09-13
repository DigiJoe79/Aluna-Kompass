import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { asset, date, defineTemplate, list, markdown, number, objectList, reference, references, select, text, type InferContent } from '../src';

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

/**
 * Die Form von content.json folgt der Deklaration. Ein Template, das seine
 * Typen von Hand schreibt, merkt ein umbenanntes Feld erst auf der leeren
 * Seite; mit dem abgeleiteten Typ bricht der Build.
 */
describe('InferContent', () => {
  type Content = InferContent<typeof template>;

  it('derives variables, collection entries with their traits, views and assets', () => {
    expectTypeOf<Content['variables']['claim']>().toEqualTypeOf<Record<string, string> | undefined>();
    expectTypeOf<Content['variables']['members']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Content['collections']['articles'][number]['title']>().toEqualTypeOf<Record<string, string>>();
    expectTypeOf<Content['collections']['articles'][number]['slug']>().toEqualTypeOf<string>();
    expectTypeOf<Content['collections']['team'][number]['photo']>().toEqualTypeOf<string | null>();
    expectTypeOf<Content['collections']['team'][number]['sortOrder']>().toEqualTypeOf<number>();
    // Kein Slug ohne `slug: true`, keine Reihenfolge ohne `sortable: true`.
    expectTypeOf<'slug' extends keyof Content['collections']['team'][number] ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<'sortOrder' extends keyof Content['collections']['articles'][number] ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<Content['views']>().toEqualTypeOf<Record<string, unknown[]>>();
    expectTypeOf<Content['assets'][number]['filename']>().toEqualTypeOf<string>();
    // Ein Feld, das es nicht gibt, ist ein Typfehler — das ist der Zweck.
    expectTypeOf<'subtitle' extends keyof Content['variables'] ? true : false>().toEqualTypeOf<false>();
  });
});

describe('reference fields', () => {
  it('reference carries view, key, labelField and where as widget metadata, with slug and name as defaults', () => {
    const schema = z.toJSONSchema(reference({ view: 'animals', label: 'Hund auf der Startseite', where: { status: 'lookingForHome', story: { present: true } } }), { io: 'input' }) as Record<string, unknown>;
    expect(schema).toMatchObject({ widget: 'reference', view: 'animals', key: 'slug', labelField: 'name', label: 'Hund auf der Startseite', where: { status: 'lookingForHome', story: { present: true } } });
    expect(reference({ view: 'animals' }).parse(null)).toBe(null);
    expect(reference({ view: 'animals' }).parse('chiara')).toBe('chiara');
    expect(reference({ view: 'animals' }).parse(undefined)).toBe(null);
  });

  it('references is an ordered list with maxItems, and needs a positive max', () => {
    const schema = z.toJSONSchema(references({ view: 'projects', max: 2, label: 'Projekte' }), { io: 'input' }) as Record<string, unknown>;
    expect(schema).toMatchObject({ widget: 'references', view: 'projects', key: 'slug', labelField: 'name', maxItems: 2 });
    expect(references({ view: 'projects', max: 2 }).parse(['a', 'b'])).toEqual(['a', 'b']);
    expect(references({ view: 'projects', max: 2 }).safeParse(['a', 'b', 'c']).success).toBe(false);
    expect(() => references({ view: 'projects', max: 0 })).toThrow(/max/);
    expect(() => references({ view: 'projects', max: 1.5 })).toThrow(/max/);
  });

  it('rejects an empty view and anything in where beyond a scalar or { present: true }', () => {
    expect(() => reference({ view: ' ' })).toThrow(/view/);
    expect(() => reference({ view: 'animals', where: { story: { present: false } as never } })).toThrow(/where/);
    expect(() => reference({ view: 'animals', where: { status: ['a'] as never } })).toThrow(/where/);
    expect(() => reference({ view: 'animals', where: { story: { present: true, extra: 1 } as never } })).toThrow(/where/);
  });

  it('types a reference variable as string | null | undefined and a references variable as string[] | undefined', () => {
    const t = defineTemplate({ name: 'X', locales: ['de'], variables: { dog: reference({ view: 'animals' }), projects: references({ view: 'projects', max: 2 }) }, collections: {}, uses: ['animals', 'projects'] });
    expectTypeOf<InferContent<typeof t>['variables']['dog']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<InferContent<typeof t>['variables']['projects']>().toEqualTypeOf<string[] | undefined>();
  });
});

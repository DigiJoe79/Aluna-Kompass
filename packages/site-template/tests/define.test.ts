import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { asset, date, defineTemplate, isRatio, list, markdown, number, objectList, reference, references, select, text, type InferContent } from '../src';

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

  // Einheit im Feld (Runde 3, 135; MUSTER § E): Das Template nennt sie, Kompass zeigt sie rechts im Feld statt in der
  // Bezeichnung („Mitgliedsbeitrag im Jahr (Euro)“).
  it('carries unit of a number into the schema, and leaves it out without one', () => {
    expect((z.toJSONSchema(number({ label: 'Beitrag', unit: '€' }), { io: 'input' }) as { unit?: string }).unit).toBe('€');
    expect('unit' in (z.toJSONSchema(number({ label: 'Beitrag' }), { io: 'input' }) as object)).toBe(false);
  });

  // Größe und Abschnitt der Maske (docs/MUSTER.md § J): Das Template sagt, wie breit ein Feld steht und unter
  // welchem Titel es mit seinen Nachbarn erscheint; ohne Angabe wählt Kompass nach dem Feldtyp.
  it('carries size and group into the schema, for every field helper', () => {
    const opts = { label: 'A', size: 'm', group: 'Bilder' } as const;
    const cases = {
      text: text(opts),
      localized: text({ ...opts, localized: true }),
      markdown: markdown(opts),
      number: number(opts),
      asset: asset(opts),
      select: select(['a', 'b'], opts),
      list: list(text(), opts),
      date: date(opts),
      objectList: objectList({ ...opts, fields: { a: text() } }),
      reference: reference({ ...opts, view: 'animals' }),
      references: references({ ...opts, view: 'animals', max: 2 }),
    };
    for (const [name, field] of Object.entries(cases)) {
      const json = z.toJSONSchema(field as never, { io: 'input' }) as { size?: string; group?: string };
      expect(json.size, `${name} verliert size`).toBe('m');
      expect(json.group, `${name} verliert group`).toBe('Bilder');
    }
  });

  it('leaves size and group out where they were not given', () => {
    const json = z.toJSONSchema(text({ label: 'A' }) as never, { io: 'input' });
    expect(json).not.toHaveProperty('size');
    expect(json).not.toHaveProperty('group');
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

// Ausschnitt für alle Bilder (Spec 2026-10-10 § 2): Format und Anzeigebreite einer Bildstelle, freiwillig.
describe('image places', () => {
  it('asset carries ratio and width into the schema', () => {
    const fixed = z.toJSONSchema(asset({ label: 'Foto', ratio: '1:1', width: 320 }), { io: 'input' }) as { ratio?: unknown; width?: unknown; accept?: string };
    expect(fixed.ratio).toBe('1:1');
    expect(fixed.width).toBe(320);
    expect(fixed.accept).toBe('image/*');
    const choice = z.toJSONSchema(asset({ ratio: ['16:10', '16:9'] }), { io: 'input' }) as { ratio?: unknown };
    expect(choice.ratio).toEqual(['16:10', '16:9']);
    expect(z.toJSONSchema(asset({ ratio: 'original' }), { io: 'input' })).toMatchObject({ ratio: 'original' });
  });

  it('leaves ratio and width out where they were not given', () => {
    const json = z.toJSONSchema(asset({ label: 'Foto' }), { io: 'input' }) as Record<string, unknown>;
    expect('ratio' in json).toBe(false);
    expect('width' in json).toBe(false);
  });

  it('rejects a ratio that is not W:H with whole numbers 1–99 or original, and a width that is not a positive integer', () => {
    for (const bad of ['4/3', '0:1', '100:1', '1.5:1', 'quer', '', '4:3:2']) {
      expect(() => asset({ ratio: bad as never }), bad).toThrow(/ratio/i);
    }
    expect(() => asset({ ratio: [] as never })).toThrow(/ratio/i);
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => asset({ width: bad }), String(bad)).toThrow(/width/i);
  });

  it('keeps the image places of the module views under open keys, and checks their ratio', () => {
    const t = defineTemplate({
      name: 'X',
      locales: ['de'],
      variables: {},
      collections: {},
      images: { 'animals.primary': { ratio: '4:5', width: 600 }, 'projects.image': { ratio: ['16:10', '16:9'] } },
    });
    expect(t.images).toEqual({ 'animals.primary': { ratio: '4:5', width: 600 }, 'projects.image': { ratio: ['16:10', '16:9'] } });
    expect(() => defineTemplate({ name: 'X', locales: ['de'], variables: {}, collections: {}, images: { 'animals.story': { ratio: '4x5' as never } } })).toThrow(/ratio/i);
    expect(() => defineTemplate({ name: 'X', locales: ['de'], variables: {}, collections: {}, images: { 'animals.story': { ratio: '4:5', width: 0 } } })).toThrow(/width/i);
  });

  // Welche Stellen es gibt, wissen die Module von Kompass; das Template-Paket zählt sie nicht auf (Joe 2026-10-10).
  it('takes a place no module of today knows, without complaint', () => {
    const t = defineTemplate({ name: 'X', locales: ['de'], variables: {}, collections: {}, images: { 'shop.banner': { ratio: '3:1' } } });
    expect(t.images).toEqual({ 'shop.banner': { ratio: '3:1' } });
  });

  it('carries ratio and width of an asset inside a list of objects', () => {
    const gallery = objectList({ label: 'Galerie', fields: { image: asset({ label: 'Bild', ratio: '4:3', width: 480 }) } });
    const json = z.toJSONSchema(gallery, { io: 'input' }) as { items?: { properties?: { image?: { ratio?: string; width?: number } } } };
    expect(json.items?.properties?.image).toMatchObject({ ratio: '4:3', width: 480 });
  });

  it('gives a template without image places an empty object, nothing else changes', () => {
    const t = defineTemplate({ name: 'X', locales: ['de'], variables: {}, collections: {} });
    expect(t.images).toEqual({});
    expect(isRatio('3:2')).toBe(true);
    expect(isRatio('original')).toBe(true);
    expect(isRatio('3-2')).toBe(false);
  });
});

import { schema as core, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asset, markdown, objectList, text } from '@kompass/site-template';
import { createEntry, getEntry } from '../src/entries';
import type { FieldSchema, TemplateSchema } from '../src/load';
import { siteModule } from '../src/manifest';
import { siteTemplateState } from '../src/schema';
import { entryLabel, localizedPaths, siteSetTranslations, siteTranslatables } from '../src/translations';
import { readValues, setValues } from '../src/values';

const asJson = (s: unknown) => z.toJSONSchema(s as z.ZodType, { io: 'input' }) as FieldSchema;

const faq: TemplateSchema['collections'][string] = {
  label: 'Fragen',
  slug: false,
  sortable: true,
  publishable: false,
  fields: { question: asJson(text({ localized: true, label: 'Frage' })), answer: asJson(markdown({ localized: true, label: 'Antwort' })), icon: asJson(asset({ label: 'Icon' })) },
};
const team: TemplateSchema['collections'][string] = {
  label: 'Team',
  slug: true,
  sortable: false,
  publishable: true,
  fields: { name: asJson(text({ label: 'Name' })), role: asJson(text({ localized: true, label: 'Aufgabe' })) },
};
const variables: Record<string, FieldSchema> = {
  claim: asJson(text({ localized: true, max: 120, label: 'Claim' })),
  pct: asJson(z.number()),
  steps: asJson(objectList({ label: 'Schritte', fields: { title: text({ localized: true, label: 'Titel' }), count: z.number() } })),
};

const manage = ctxWith(['site.manage', 'site.view']);
const view = ctxWith(['site.view']);

const setup = (templateLocales = ['de', 'en'], installation = ['de', 'en']) => {
  const deps = createTestDeps({ locales: installation });
  insertUser(deps, { id: 'USER-TEST' });
  deps.db
    .insert(siteTemplateState)
    .values({ id: 'current', name: 'Verein Basis', schemaJson: { name: 'Verein Basis', locales: templateLocales, uses: [], variables, collections: { faq, team } }, checksum: 'a'.repeat(64), readAt: 't', readByUserId: null })
    .run();
  return deps;
};

describe('entryLabel and localizedPaths', () => {
  it('labels like the list page: first text-like field in the leading locale, then slug, then id', () => {
    expect(entryLabel(faq, { id: 'E1', slug: null, data: { question: { de: 'Wie spende ich?', en: '' } } }, 'de')).toBe('Wie spende ich?');
    expect(entryLabel(team, { id: 'E2', slug: 'anna', data: { name: 'Anna', role: { de: 'Kasse' } } }, 'de')).toBe('Anna');
    expect(entryLabel(team, { id: 'E3', slug: 'x', data: { name: '', role: {} } }, 'de')).toBe('x');
    expect(entryLabel(faq, { id: 'E4', slug: null, data: {} }, 'de')).toBe('E4');
  });

  it('finds localized values at top level and inside object lists, markdown included', () => {
    const value = { claim: { de: 'Willkommen', en: '' }, pct: 3, steps: [{ title: { de: 'Eins', en: 'One' }, count: 1 }, { title: { de: 'Zwei', en: '' }, count: 2 }] };
    expect(localizedPaths(variables, value)).toEqual({ claim: { de: 'Willkommen', en: '' }, 'steps[0].title': { de: 'Eins', en: 'One' }, 'steps[1].title': { de: 'Zwei', en: '' } });
    expect(localizedPaths(faq.fields, { question: { de: 'F' }, answer: { de: 'A' }, icon: null })).toEqual({ question: { de: 'F' }, answer: { de: 'A' } });
  });
});

describe('siteTranslatables', () => {
  it('reports the variables as one record and every entry, drafts included, all bound to the template locales', async () => {
    const deps = setup(['de'], ['de', 'en']);
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'Willkommen', en: '' }, steps: [{ title: { de: 'Eins', en: '' }, count: 1 }] } }));
    const q = unwrap(await createEntry(deps, manage, { collection: 'faq', data: { question: { de: 'Wie?', en: '' }, answer: { de: 'So.', en: '' } } }));
    const t = unwrap(await createEntry(deps, manage, { collection: 'team', slug: 'anna', data: { name: 'Anna', role: { de: 'Kasse', en: '' } } }));
    const rows = unwrap(siteTranslatables(deps, view));
    expect(rows).toEqual([
      { entityType: 'site.variables', id: 'variables', label: 'Verein Basis', href: '/site/variables', locales: ['de'], fields: { claim: { de: 'Willkommen', en: '' }, 'steps[0].title': { de: 'Eins', en: '' } } },
      { entityType: 'site.entry', id: q.id, label: 'Wie?', href: `/site/c/faq/${q.id}`, locales: ['de'], fields: { question: { de: 'Wie?', en: '' }, answer: { de: 'So.', en: '' } } },
      { entityType: 'site.entry', id: t.id, label: 'Anna', href: `/site/c/team/${t.id}`, locales: ['de'], fields: { role: { de: 'Kasse', en: '' } } },
    ]);
  });

  it('is empty without a template and forbidden without site.view', () => {
    const bare = createTestDeps({ locales: ['de', 'en'] });
    expect(unwrap(siteTranslatables(bare, view))).toEqual([]);
    expect(siteTranslatables(setup(), ctxWith([])).ok).toBe(false);
  });
});

describe('siteSetTranslations', () => {
  it('writes a nested variable through setValues, touching only that top-level variable and one locale', async () => {
    const deps = setup();
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'Willkommen', en: '' }, pct: 7, steps: [{ title: { de: 'Eins', en: '' }, count: 1 }, { title: { de: 'Zwei', en: '' }, count: 2 }] } }));
    const auditBefore = deps.db.select().from(core.auditLog).all().length;
    const result = await siteSetTranslations(deps, manage, { entityType: 'site.variables', id: 'variables', items: [{ field: 'steps[1].title', locale: 'en', text: 'Two' }, { field: 'claim', locale: 'en', text: 'Welcome' }] });
    expect(result && (await result).ok).toBe(true);
    expect(readValues(deps)).toEqual({ claim: { de: 'Willkommen', en: 'Welcome' }, pct: 7, steps: [{ title: { de: 'Eins', en: '' }, count: 1 }, { title: { de: 'Zwei', en: 'Two' }, count: 2 }] });
    const audits = deps.db.select().from(core.auditLog).all().slice(auditBefore);
    expect(audits.map((e) => e.action)).toEqual(['site.values.update']);
    expect(audits[0]?.summary).toContain('steps');
  });

  it('writes an entry field through updateEntry with one audit entry', async () => {
    const deps = setup();
    const q = unwrap(await createEntry(deps, manage, { collection: 'faq', data: { question: { de: 'Wie?', en: '' }, answer: { de: 'So.', en: '' } } }));
    const auditBefore = deps.db.select().from(core.auditLog).all().length;
    const result = await siteSetTranslations(deps, manage, { entityType: 'site.entry', id: q.id, items: [{ field: 'question', locale: 'en', text: 'How?' }, { field: 'answer', locale: 'en', text: 'Like this.' }] });
    expect(result && (await result).ok).toBe(true);
    // `icon` bekommt beim Anlegen seinen Leerwert `null` (Zod-4-Default hinter `.optional()`).
    expect(unwrap(await getEntry(deps, view, q.id)).data).toEqual({ question: { de: 'Wie?', en: 'How?' }, answer: { de: 'So.', en: 'Like this.' }, icon: null });
    expect(deps.db.select().from(core.auditLog).all().slice(auditBefore).map((e) => e.action)).toEqual(['site.entry.update']);
  });

  it('is null for foreign types, forbidden without manage, notFound for unknown ids and paths', async () => {
    const deps = setup();
    expect(siteSetTranslations(deps, manage, { entityType: 'animal', id: 'x', items: [] })).toBeNull();
    const denied = await siteSetTranslations(deps, view, { entityType: 'site.variables', id: 'variables', items: [{ field: 'claim', locale: 'en', text: 'x' }] });
    expect(denied && !denied.ok && denied.error.type).toBe('forbidden');
    const missing = await siteSetTranslations(deps, manage, { entityType: 'site.entry', id: 'nope', items: [{ field: 'question', locale: 'en', text: 'x' }] });
    expect(missing && !missing.ok && missing.error).toEqual({ type: 'notFound', entity: 'siteEntry', id: 'nope' });
    const path = await siteSetTranslations(deps, manage, { entityType: 'site.variables', id: 'variables', items: [{ field: 'steps[4].title', locale: 'en', text: 'x' }] });
    expect(path && !path.ok && path.error).toEqual({ type: 'notFound', entity: 'field', id: 'steps[4].title' });
    const notLocalized = await siteSetTranslations(deps, manage, { entityType: 'site.variables', id: 'variables', items: [{ field: 'pct', locale: 'en', text: 'x' }] });
    expect(notLocalized && !notLocalized.ok && notLocalized.error).toEqual({ type: 'notFound', entity: 'field', id: 'pct' });
  });

  it('is wired into the manifest', () => {
    expect(siteModule.translatables).toBe(siteTranslatables);
    expect(siteModule.setTranslations).toBe(siteSetTranslations);
  });
});

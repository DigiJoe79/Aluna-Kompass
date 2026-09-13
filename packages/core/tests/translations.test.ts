import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { settings } from '../src/db/schema';
import { listTranslationGaps, setTranslations } from '../src/i18n/translations';
import { defineModule, type Translatable, type TranslationWrite } from '../src/modules/manifest';
import { forbidden, notFound, ok, type Result } from '../src/result';
import { createTestDeps, ctxWith } from '../src/testing';

/** Ein erfundenes Modul mit zwei Datensätzen; `store` hält, was geschrieben wurde. */
function fakeModule(opts: { key: string; permission: string; rows: Translatable[]; store: TranslationWrite[] }) {
  return defineModule({
    key: opts.key,
    version: '0',
    permissions: [opts.permission],
    translatables: (_deps, ctx) => (ctx.permissions.has(opts.permission) ? ok(opts.rows) : forbidden(opts.permission)),
    setTranslations: (_deps, ctx, input) => {
      if (!input.entityType.startsWith(opts.key)) return null;
      return (async (): Promise<Result<unknown>> => {
        if (!ctx.permissions.has(opts.permission)) return forbidden(opts.permission);
        if (!opts.rows.some((r) => r.id === input.id)) return notFound(input.entityType, input.id);
        opts.store.push(input);
        return ok(null);
      })();
    },
  });
}

const rows: Translatable[] = [
  { entityType: 'pets.pet', id: 'P1', label: 'Bruno', href: '/pets/P1', fields: { summary: { de: 'Sanfter Rüde', en: '' }, traits: { de: ['ruhig'], en: [] }, body: { de: '', en: '' } } },
  { entityType: 'pets.pet', id: 'P2', label: 'Akiko', href: '/pets/P2', fields: { summary: { de: 'Wirbelwind', en: 'Whirlwind' } } },
];
const pages: Translatable[] = [
  { entityType: 'web.page', id: 'home', label: 'Start', href: '/web', fields: { claim: { de: 'Willkommen', en: '' } }, locales: ['de'] },
  { entityType: 'web.page', id: 'about', label: 'Über uns', href: '/web/about', fields: { claim: { de: 'Wer wir sind', en: '', fr: '' } }, locales: ['de', 'en'] },
];

function setup(locales = ['de', 'en']) {
  const petStore: TranslationWrite[] = [];
  const webStore: TranslationWrite[] = [];
  const pets = fakeModule({ key: 'pets', permission: 'pets.manage', rows, store: petStore });
  const web = fakeModule({ key: 'web', permission: 'web.manage', rows: pages, store: webStore });
  const deps = createTestDeps({ manifests: [coreModule, pets, web], locales });
  deps.db.insert(settings).values({ key: 'modules.enabled', value: JSON.stringify(['pets', 'web']), updatedAt: 'now' }).run();
  return { deps, petStore, webStore };
}

describe('listTranslationGaps', () => {
  it('lists leading-filled, target-empty fields with the source text, lists included', async () => {
    const { deps } = setup();
    const result = await listTranslationGaps(deps, ctxWith(['pets.manage', 'web.manage']));
    expect(result.ok && result.value.omitted).toEqual([]);
    expect(result.ok && result.value.gaps).toEqual([
      { entityType: 'pets.pet', id: 'P1', label: 'Bruno', href: '/pets/P1', field: 'summary', locale: 'en', source: { locale: 'de', text: 'Sanfter Rüde' } },
      { entityType: 'pets.pet', id: 'P1', label: 'Bruno', href: '/pets/P1', field: 'traits', locale: 'en', source: { locale: 'de', text: ['ruhig'] } },
      { entityType: 'web.page', id: 'about', label: 'Über uns', href: '/web/about', field: 'claim', locale: 'en', source: { locale: 'de', text: 'Wer wir sind' } },
    ]);
  });

  it('respects the locales a record is rendered in and never reports locales the installation lacks', async () => {
    const { deps } = setup();
    const result = await listTranslationGaps(deps, ctxWith(['web.manage']), { entityType: 'web.page' });
    // `home` wird nur in `de` ausgespielt: keine Lücke. `about` kennt `fr`, die Installation nicht: keine Lücke.
    expect(result.ok && result.value.gaps.map((g) => `${g.id}:${g.locale}`)).toEqual(['about:en']);
  });

  it('filters by locale and rejects one the installation does not keep', async () => {
    const { deps } = setup(['de', 'en', 'pt']);
    const pt = await listTranslationGaps(deps, ctxWith(['pets.manage']), { locale: 'pt' });
    expect(pt.ok && pt.value.gaps.map((g) => `${g.id}.${g.field}`)).toEqual(['P1.summary', 'P1.traits', 'P2.summary']);
    const bad = await listTranslationGaps(deps, ctxWith(['pets.manage']), { locale: 'fr' });
    expect(bad.ok === false && bad.error.type === 'validation' && bad.error.issues).toEqual([{ path: 'locale', message: 'unknownLocale' }]);
  });

  it('names modules the caller may not read under omitted and keeps the rest', async () => {
    const { deps } = setup();
    const result = await listTranslationGaps(deps, ctxWith(['web.manage']));
    expect(result.ok && result.value.omitted).toEqual(['pets']);
    expect(result.ok && result.value.gaps.map((g) => g.entityType)).toEqual(['web.page']);
    const nothing = await listTranslationGaps(deps, ctxWith([]));
    expect(nothing.ok && nothing.value).toEqual({ gaps: [], omitted: ['pets', 'web'] });
  });

  it('is empty with a single locale', async () => {
    const { deps } = setup(['de']);
    const result = await listTranslationGaps(deps, ctxWith(['pets.manage', 'web.manage']));
    expect(result.ok && result.value.gaps).toEqual([]);
  });
});

describe('setTranslations', () => {
  it('groups items per record and hands each group to its module once', async () => {
    const { deps, petStore, webStore } = setup();
    const result = await setTranslations(deps, ctxWith(['pets.manage', 'web.manage']), {
      items: [
        { entityType: 'pets.pet', id: 'P1', field: 'summary', locale: 'en', text: 'Gentle boy' },
        { entityType: 'web.page', id: 'about', field: 'claim', locale: 'en', text: 'Who we are' },
        { entityType: 'pets.pet', id: 'P1', field: 'traits', locale: 'en', text: ['calm'] },
      ],
    });
    expect(result.ok && result.value).toEqual({ applied: 3, failed: [] });
    expect(petStore).toEqual([{ entityType: 'pets.pet', id: 'P1', items: [{ field: 'summary', locale: 'en', text: 'Gentle boy' }, { field: 'traits', locale: 'en', text: ['calm'] }] }]);
    expect(webStore).toEqual([{ entityType: 'web.page', id: 'about', items: [{ field: 'claim', locale: 'en', text: 'Who we are' }] }]);
  });

  it('reports a failed group with all its indexes and still writes the others', async () => {
    const { deps, petStore } = setup();
    const result = await setTranslations(deps, ctxWith(['pets.manage', 'web.manage']), {
      items: [
        { entityType: 'pets.pet', id: 'P9', field: 'summary', locale: 'en', text: 'a' },
        { entityType: 'pets.pet', id: 'P1', field: 'summary', locale: 'en', text: 'b' },
        { entityType: 'pets.pet', id: 'P9', field: 'body', locale: 'en', text: 'c' },
        { entityType: 'cars.car', id: 'C1', field: 'name', locale: 'en', text: 'd' },
      ],
    });
    expect(result.ok && result.value.applied).toBe(1);
    expect(result.ok && result.value.failed).toEqual([
      { index: 0, error: { type: 'notFound', entity: 'pets.pet', id: 'P9' } },
      { index: 2, error: { type: 'notFound', entity: 'pets.pet', id: 'P9' } },
      { index: 3, error: { type: 'notFound', entity: 'cars.car', id: 'C1' } },
    ]);
    expect(petStore.map((w) => w.id)).toEqual(['P1']);
  });

  it('passes forbidden through per group', async () => {
    const { deps, petStore } = setup();
    const result = await setTranslations(deps, ctxWith(['web.manage']), { items: [{ entityType: 'pets.pet', id: 'P1', field: 'summary', locale: 'en', text: 'x' }] });
    expect(result.ok && result.value.failed).toEqual([{ index: 0, error: { type: 'forbidden', permission: 'pets.manage' } }]);
    expect(petStore).toEqual([]);
  });

  it('rejects the whole call for an unknown locale or an empty list before writing anything', async () => {
    const { deps, petStore } = setup();
    const bad = await setTranslations(deps, ctxWith(['pets.manage']), {
      items: [{ entityType: 'pets.pet', id: 'P1', field: 'summary', locale: 'en', text: 'x' }, { entityType: 'pets.pet', id: 'P1', field: 'body', locale: 'fr', text: 'y' }],
    });
    expect(bad.ok === false && bad.error.type === 'validation' && bad.error.issues).toEqual([{ path: 'items.1.locale', message: 'unknownLocale' }]);
    expect(petStore).toEqual([]);
    expect((await setTranslations(deps, ctxWith(['pets.manage']), { items: [] })).ok).toBe(false);
  });
});

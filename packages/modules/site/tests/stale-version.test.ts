import { unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asset, text } from '@kompass/site-template';
import { createEntry, getEntry, updateEntry } from '../src/entries';
import type { FieldSchema, TemplateSchema } from '../src/load';
import { siteTemplateState } from '../src/schema';
import { readValues, setValues, valuesVersion } from '../src/values';

/** Backlog 20: siehe `animals/tests/stale-version.test.ts`. */
const asJson = (s: unknown) => z.toJSONSchema(s as z.ZodType, { io: 'input' }) as FieldSchema;
const manage = ctxWith(['site.manage', 'site.view']);

const withTemplate = (schema: Pick<TemplateSchema, 'variables' | 'collections'>) => {
  const deps = createTestDeps({ locales: ['de', 'en'] });
  insertUser(deps, { id: 'USER-TEST' });
  deps.db
    .insert(siteTemplateState)
    .values({ id: 'current', name: 'T', schemaJson: { name: 'T', locales: ['de', 'en'], uses: [], ...schema }, checksum: 'a'.repeat(64), readAt: 't', readByUserId: null })
    .run();
  return deps;
};

describe('updateEntry mit Ladestand', () => {
  const faq: TemplateSchema['collections'][string] = { label: 'FAQ', slug: false, sortable: true, publishable: false, fields: { answer: asJson(text({ label: 'Antwort', localized: true })) } };

  it('weist ein Speichern auf veraltetem Stand ab und lässt die Zwischenänderung stehen', async () => {
    const deps = withTemplate({ variables: {}, collections: { faq } });
    const loaded = unwrap(await createEntry(deps, manage, { collection: 'faq', data: { answer: { de: 'Ja', en: '' } } }));
    deps.clock.advance(60_000);
    unwrap(await updateEntry(deps, manage, { id: loaded.id, data: { answer: { de: 'Ja', en: 'Yes' } } }));
    deps.clock.advance(60_000);

    const stale = await updateEntry(deps, manage, { id: loaded.id, data: { answer: { de: 'Jawohl', en: '' } }, expectedVersion: loaded.updatedAt });

    expect(stale).toMatchObject({ ok: false, error: { type: 'conflict', code: 'staleVersion' } });
    expect((unwrap(await getEntry(deps, manage, loaded.id)).data as { answer: unknown }).answer).toEqual({ de: 'Ja', en: 'Yes' });
  });

  it('speichert, wer den aktuellen Stand nennt', async () => {
    const deps = withTemplate({ variables: {}, collections: { faq } });
    const loaded = unwrap(await createEntry(deps, manage, { collection: 'faq', data: { answer: { de: 'Ja', en: '' } } }));
    deps.clock.advance(60_000);
    expect((await updateEntry(deps, manage, { id: loaded.id, data: { answer: { de: 'Doch', en: '' } }, expectedVersion: loaded.updatedAt })).ok).toBe(true);
  });
});

describe('setValues mit Ladestand', () => {
  const variables = { claim: asJson(text({ localized: true })) };

  it('weist ein Speichern auf veraltetem Stand ab und lässt die Zwischenänderung stehen', async () => {
    const deps = withTemplate({ variables, collections: {} });
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'Hilfe', en: '' } } }));
    const loaded = valuesVersion(deps);
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'Hilfe', en: 'Help' } } }));

    const stale = await setValues(deps, manage, { values: { claim: { de: 'Hilfe!', en: '' } }, expectedVersion: loaded });

    expect(stale).toMatchObject({ ok: false, error: { type: 'conflict', code: 'staleVersion' } });
    expect(readValues(deps).claim).toEqual({ de: 'Hilfe', en: 'Help' });
  });

  it('erkennt auch ein zwischenzeitlich geleertes Feld, dessen Zeile verschwindet', async () => {
    const deps = withTemplate({ variables: { ...variables, hero: asJson(asset({})) }, collections: {} });
    unwrap(await setValues(deps, manage, { values: { hero: 'ASSET-1' } }));
    const loaded = valuesVersion(deps);
    unwrap(await setValues(deps, manage, { values: { hero: null } }));

    const stale = await setValues(deps, manage, { values: { claim: { de: 'Hilfe', en: '' } }, expectedVersion: loaded });

    expect(stale).toMatchObject({ ok: false, error: { type: 'conflict', code: 'staleVersion' } });
  });

  it('speichert, wer den aktuellen Stand nennt', async () => {
    const deps = withTemplate({ variables, collections: {} });
    const loaded = valuesVersion(deps);
    expect((await setValues(deps, manage, { values: { claim: { de: 'Hilfe', en: '' } }, expectedVersion: loaded })).ok).toBe(true);
  });
});

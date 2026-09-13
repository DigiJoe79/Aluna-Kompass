import { coreModule, defineModule, listTranslationGaps, ok, schema, setTranslations, type Translatable, type TranslationWrite } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { coreMcpTools } from '../src/core-tools';

const tool = (name: string) => {
  const found = coreMcpTools.find((t) => t.name === name);
  if (!found) throw new Error(`kein Werkzeug ${name}`);
  return found;
};

const rows: Translatable[] = [{ entityType: 'pets.pet', id: 'P1', label: 'Bruno', href: '/pets/P1', fields: { summary: { de: 'Sanft', en: '' } } }];

function setup() {
  const store: TranslationWrite[] = [];
  const pets = defineModule({
    key: 'pets',
    version: '0',
    permissions: ['pets.manage'],
    translatables: () => ok(rows),
    setTranslations: (_deps, _ctx, input) => (input.entityType === 'pets.pet' ? Promise.resolve((store.push(input), ok(null))) : null),
  });
  const deps = createTestDeps({ manifests: [coreModule, pets], locales: ['de', 'en'] });
  insertUser(deps, { id: 'USER-TEST' });
  deps.db.insert(schema.settings).values({ key: 'modules.enabled', value: JSON.stringify(['pets']), updatedAt: 'now' }).run();
  return { deps, store };
}

describe('translation tools', () => {
  it('are registered, name their services and the module rights', () => {
    expect(tool('translations_list_gaps').service).toBe(listTranslationGaps);
    expect(tool('translations_set').service).toBe(setTranslations);
    for (const right of ['animals.view', 'projects.view', 'site.view']) expect(tool('translations_list_gaps').description).toContain(right);
    for (const right of ['animals.manage', 'projects.manage', 'site.manage']) expect(tool('translations_set').description).toContain(right);
  });

  it('list the gaps with the source text and write a translation back', async () => {
    const { deps, store } = setup();
    const ctx = ctxWith(['pets.manage']);
    const gaps = await tool('translations_list_gaps').handler(deps, ctx, {});
    expect(gaps.ok && gaps.value).toEqual({ gaps: [{ entityType: 'pets.pet', id: 'P1', label: 'Bruno', href: '/pets/P1', field: 'summary', locale: 'en', source: { locale: 'de', text: 'Sanft' } }], omitted: [] });
    const written = await tool('translations_set').handler(deps, ctx, { items: [{ entityType: 'pets.pet', id: 'P1', field: 'summary', locale: 'en', text: 'Gentle' }] });
    expect(written.ok && written.value).toEqual({ applied: 1, failed: [] });
    expect(store).toEqual([{ entityType: 'pets.pet', id: 'P1', items: [{ field: 'summary', locale: 'en', text: 'Gentle' }] }]);
  });
});

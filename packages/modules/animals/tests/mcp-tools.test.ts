import { coreModule, moduleMcpTools, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src';

describe('animals mcp tools', () => {
  it('creates and lists through the tool handlers with the caller context', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule] });
    insertUser(deps, { id: 'USER-TEST' });
    await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
    const tools = Object.fromEntries(moduleMcpTools(deps, animalsModule).map((t) => [t.name, t]));
    expect(Object.keys(tools).sort()).toEqual(['animals_create', 'animals_get', 'animals_list', 'animals_set_photos', 'animals_set_published', 'animals_set_status', 'animals_set_story', 'animals_update']);
    const ctx = ctxWith(['animals.manage', 'animals.view']);
    const created = unwrap(await tools.animals_create!.handler(deps, ctx, tools.animals_create!.inputSchema.parse({ slug: 'luna', name: 'Luna', sex: 'female', birthText: { de: '2022', en: '' }, sizeText: { de: '40 cm', en: '' }, summary: { de: 'x', en: '' }, body: { de: 'y', en: '' } }))) as { id: string };
    const listed = unwrap(await tools.animals_list!.handler(deps, ctx, {})) as { id: string }[];
    expect(listed.map((a) => a.id)).toEqual([created.id]);
    const denied = await tools.animals_create!.handler(deps, ctxWith(['animals.view']), { slug: 'x', name: 'X', sex: 'male', birthText: { de: '', en: '' }, sizeText: { de: '', en: '' }, summary: { de: '', en: '' }, body: { de: '', en: '' } });
    expect(denied.ok).toBe(false);
  });
});

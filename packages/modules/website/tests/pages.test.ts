import { coreModule, schema, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { getPage, listPages, updatePage, WEBSITE_PAGE_KEYS, websiteModule } from '../src';

const deps = () => { const d = createTestDeps({ manifests: [coreModule, websiteModule], locales: ['de', 'en'] }); insertUser(d, { id: 'USER-TEST' }); return d; };
const manage = ctxWith(['website.manage', 'website.view']);

describe('pages', () => {
  it('materialises all declared page keys on first list, empty and without audit noise', async () => {
    const d = deps();
    const pages = unwrap(await listPages(d, ctxWith(['website.view'])));
    expect(pages.map((p) => p.key)).toEqual([...WEBSITE_PAGE_KEYS]);
    expect(pages[0]).toMatchObject({ title: { de: '', en: '' }, blocks: [] });
    expect(d.db.select().from(schema.auditLog).all()).toHaveLength(0);
  });

  it('updates texts and blocks with validation and audit', async () => {
    const d = deps();
    const updated = unwrap(await updatePage(d, manage, {
      key: 'help',
      title: { de: 'Es gibt viele Wege, ein Leben zu *verändern.*', en: 'Many ways to *change* a life.' },
      lede: { de: 'Ob Spende oder Patenschaft.', en: '' },
      blocks: [{ id: 'donate', title: { de: 'Spenden', en: 'Donate' }, text: { de: 'Schon kleine Beträge helfen.', en: '' }, imageAssetId: null, href: '/spenden/', label: { de: 'Jetzt spenden', en: 'Donate now' } }],
    }));
    expect(updated.blocks).toHaveLength(1);
    expect(unwrap(await getPage(d, ctxWith(['website.view']), 'help')).title.en).toBe('Many ways to *change* a life.');
    const entry = d.db.select().from(schema.auditLog).all().at(-1)!;
    expect(entry).toMatchObject({ action: 'website.pages.update', entityType: 'websitePage', entityId: 'help' });
    const unknown = await updatePage(d, manage, { key: 'nope', title: { de: 'x', en: '' } });
    expect(unknown.ok === false && unknown.error.type === 'notFound').toBe(true);
    const badBlock = await updatePage(d, manage, { key: 'help', blocks: [{ id: 'x', title: { de: 'T', en: '' }, text: { de: '', en: '' }, imageAssetId: 'missing', href: '/x/', label: { de: 'L', en: '' } }] });
    expect(badBlock.ok === false && badBlock.error.type === 'notFound').toBe(true);
    expect((await updatePage(d, ctxWith(['website.view']), { key: 'help', lede: { de: 'x', en: '' } })).ok).toBe(false);
  });
});

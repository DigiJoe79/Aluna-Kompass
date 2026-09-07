import { addLocale, coreModule, previewLocaleRemoval, readSetting, removeLocale, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { websiteModule } from '../src';
import { websitePages } from '../src/schema';
import { updatePage } from '../src/services/pages';

/** Mehrsprachiger Text steckt nicht nur in eigenen Spalten, sondern auch in
 *  Bausteinen und Einstellungen. Ein Sprachwechsel muss ihn überall erreichen. */
describe('removing a locale reaches page blocks and settings', () => {
  const setup = async () => {
    const deps = createTestDeps({ manifests: [coreModule, websiteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const ctx = ctxWith(['settings.manage', 'website.manage', 'website.view']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    unwrap(await updatePage(deps, ctx, {
      key: 'about',
      title: { de: 'Über uns', en: 'About us' },
      lede: { de: '' }, body: { de: '' }, metaDescription: { de: '' },
      blocks: [{ id: 'b1', title: { de: 'Baustein', en: 'Block' }, text: { de: 'Text', en: 'Text EN' }, imageAssetId: null, href: '', label: { de: '' } }],
    }));
    unwrap(await setSetting(deps, ctx, { key: 'website.claim', value: { de: 'Ein Verein', en: 'A club' } }));
    return { deps, ctx };
  };

  it('counts column text, block text and settings in the preview', async () => {
    const { deps, ctx } = await setup();
    const preview = unwrap(await previewLocaleRemoval(deps, ctx, { code: 'en' }));
    expect(preview.tables.some((t) => t.table === 'website_pages' && t.column === 'title')).toBe(true);
    expect(preview.tables.some((t) => t.table === 'website_pages' && t.column === 'blocks')).toBe(true);
    expect(preview.tables.some((t) => t.table === 'settings')).toBe(true);
    // Titel, zwei Bausteintexte, Claim
    expect(preview.filled).toBe(4);
  });

  it('strips the locale from all three of them', async () => {
    const { deps, ctx } = await setup();
    unwrap(await removeLocale(deps, ctx, { code: 'en', confirm: true }));
    const page = deps.db.select().from(websitePages).where(eq(websitePages.key, 'about')).get()!;
    expect(page.title).toEqual({ de: 'Über uns' });
    expect(page.blocks).toEqual([{ id: 'b1', title: { de: 'Baustein' }, text: { de: 'Text' }, imageAssetId: null, href: '', label: { de: '' } }]);
    expect(readSetting(deps, 'website.claim')).toEqual({ de: 'Ein Verein' });
  });
});

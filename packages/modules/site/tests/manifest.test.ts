import { coreModule, createRegistry, type NavigationItem } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { siteModule } from '../src';
import { siteTemplateState } from '../src/schema';

const withTemplate = (collections: Record<string, unknown> = {}) => {
  const deps = createTestDeps({ locales: ['de'] });
  deps.db
    .insert(siteTemplateState)
    .values({
      id: 'current',
      name: 'T',
      schemaJson: { name: 'T', locales: ['de'], uses: [], variables: {}, collections },
      checksum: 'a'.repeat(64),
      readAt: 't',
      readByUserId: null,
    })
    .run();
  return deps;
};

const hrefs = (items: readonly NavigationItem[] | undefined) => (items ?? []).map((i) => i.href);

describe('site module', () => {
  it('registers its permissions and navigation without clashes', () => {
    const registry = createRegistry([coreModule, siteModule]);
    expect(siteModule.key).toBe('site');
    expect(registry.permissionKeys.has('site.manage')).toBe(true);
    expect(registry.permissionKeys.has('site.publish')).toBe(true);
  });

  it('keeps publishing in the rail without a template and points settings to /admin/site', () => {
    const empty = createTestDeps({ locales: ['de'] });
    expect(hrefs(siteModule.navigation)).toEqual(['/site/publish']);
    expect(hrefs(siteModule.navigationFor?.(empty))).toEqual([]);
    expect(siteModule.adminNavigation).toEqual([{ key: 'site.admin', href: '/admin/site', icon: 'globe', permission: 'site.manage' }]);
  });

  it('adds variables behind a section break, then the collections', () => {
    const items = siteModule.navigationFor?.(withTemplate({ news: { label: 'News', fields: {} } })) ?? [];
    expect(items.map((i) => i.href)).toEqual(['/site/variables', '/site/c/news']);
    expect(items[0]?.sectionBreak).toBe(true);
  });
});

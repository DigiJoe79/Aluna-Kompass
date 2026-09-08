import { coreModule, createRegistry, type NavigationItem } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { siteModule } from '../src';
import { siteTemplateState } from '../src/schema';

const withTemplate = () => {
  const deps = createTestDeps({ locales: ['de'] });
  deps.db
    .insert(siteTemplateState)
    .values({
      id: 'current',
      name: 'T',
      schemaJson: { name: 'T', locales: ['de'], uses: [], variables: {}, collections: {} },
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
    expect(siteModule.navigation?.some((n) => n.href === '/site/template')).toBe(true);
  });

  /**
   * Ohne eingelesenes Template gibt es nichts zu veröffentlichen: Der Export
   * lehnt mit `noTemplate` ab. Der Eintrag führte bis dahin auf eine Seite,
   * die nur scheitern konnte — das Einlesen bleibt der einzige Weg hinein.
   */
  it('offers publishing only once a template has been read', () => {
    const empty = createTestDeps({ locales: ['de'] });
    expect(hrefs(siteModule.navigationFor?.(empty))).not.toContain('/site/publish');
    expect(hrefs(siteModule.navigation)).not.toContain('/site/publish');

    expect(hrefs(siteModule.navigationFor?.(withTemplate()))).toContain('/site/publish');
  });

  it('always offers the way in', () => {
    const empty = createTestDeps({ locales: ['de'] });
    expect([...hrefs(siteModule.navigation), ...hrefs(siteModule.navigationFor?.(empty))]).toContain('/site/template');
  });
});

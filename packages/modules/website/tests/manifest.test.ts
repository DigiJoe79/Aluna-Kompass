import { coreModule, createRegistry, readSetting } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { WEBSITE_PAGE_KEYS, websiteModule } from '../src';

describe('website module manifest', () => {
  it('registers permissions, settings and navigation without clashing with core', () => {
    const registry = createRegistry([coreModule, websiteModule]);
    expect([...registry.permissionKeys]).toEqual(expect.arrayContaining(['website.view', 'website.manage']));
    expect(registry.settingDefinitions.get('website.forwardingPercent')?.default).toBe(97.2);
    expect(registry.settingDefinitions.get('website.blockedTerms')?.default).toEqual([]);
    expect(websiteModule.navigation?.map((n) => n.key)).toEqual(['website.pages', 'website.articles', 'website.team', 'website.faqs', 'website.projects', 'website.downloads', 'website.facts']);
  });

  it('creates its tables through the core migration chain', () => {
    const deps = createTestDeps({ manifests: [coreModule, websiteModule] });
    const tables = (deps.sqlite.prepare("select name from sqlite_master where type='table' and name like 'website_%' order by name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(['website_articles', 'website_downloads', 'website_faqs', 'website_pages', 'website_team']);
    expect(readSetting(deps, 'website.section11Status')).toBe('pending');
    expect(WEBSITE_PAGE_KEYS).toHaveLength(12);
  });

  it('validates settings values', () => {
    const registry = createRegistry([coreModule, websiteModule]);
    expect(registry.settingDefinitions.get('website.forwardingPercent')!.schema.safeParse(101).success).toBe(false);
    expect(registry.settingDefinitions.get('website.socialLinks')!.schema.safeParse([{ label: 'Instagram', href: 'https://instagram.com/aluna' }]).success).toBe(true);
    expect(registry.settingDefinitions.get('website.socialLinks')!.schema.safeParse([{ label: 'x', href: 'javascript:alert(1)' }]).success).toBe(false);
    expect(registry.settingDefinitions.get('website.featuredAnimalSlug')!.schema.safeParse('auto').success).toBe(true);
  });
});

import { coreModule, defineModule, type ModuleManifest } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { buildNavigation } from '@/lib/navigation';

const finance = defineModule({
  key: 'finance',
  version: '0.1.0',
  permissions: ['finance.view'],
  navigation: [{ key: 'finance.ledger', href: '/finance', icon: 'euro', group: 'finance', permission: 'finance.view' }],
});

describe('buildNavigation', () => {
  it('builds the admin group with all core entries, filtered by permission', () => {
    const groups = buildNavigation({ manifests: [coreModule], enabledKeys: new Set(['core']), permissions: new Set(['users.manage', 'audit.view']) });
    const admin = groups.find((g) => g.key === 'admin')!;
    expect(admin.items.map((i) => i.key)).toEqual(['users', 'roles', 'settings', 'locales', 'themes', 'modules', 'audit', 'documents', 'media', 'backup']);
    expect(admin.items.filter((i) => i.visible).map((i) => i.key)).toEqual(['users', 'audit']);
  });

  /**
   * Die Projekte liegen im Kern. Ohne eigene Gruppe wären sie mit dem
   * abgelösten Webseiten-Modul aus der Navigation verschwunden.
   */
  it('offers the core projects outside the admin group', () => {
    const groups = buildNavigation({ manifests: [coreModule], enabledKeys: new Set(['core']), permissions: new Set(['projects.view']) });
    const core = groups.find((g) => g.key === 'core')!;
    expect(core.items.map((i) => [i.key, i.href, i.visible])).toEqual([['projects', '/projects', true]]);
    expect(core.disabled).toBe(false);
  });

  it('hides the projects from anyone without the permission', () => {
    const groups = buildNavigation({ manifests: [coreModule], enabledKeys: new Set(['core']), permissions: new Set() });
    expect(groups.find((g) => g.key === 'core')?.items.every((i) => !i.visible)).toBe(true);
  });

  it('leaves installed but inactive modules out of the navigation entirely', () => {
    const groups = buildNavigation({ manifests: [coreModule, finance], enabledKeys: new Set(['core']), permissions: new Set(['finance.view']) });
    expect(groups.find((g) => g.key === 'finance')).toBeUndefined();
  });

  it('shows a module group once the module is active', () => {
    const groups = buildNavigation({ manifests: [coreModule, finance], enabledKeys: new Set(['core', 'finance']), permissions: new Set(['finance.view']) });
    const group = groups.find((g) => g.key === 'finance')!;
    expect(group.disabled).toBe(false);
    expect(group.items[0]).toMatchObject({ key: 'finance.ledger', href: '/finance', disabled: false });
  });

  it('adds runtime items with their own label after the static ones', () => {
    const groups = buildNavigation({
      manifests: [
        {
          key: 'site',
          version: '1',
          permissions: ['site.manage'],
          navigation: [{ key: 'site.template', href: '/site/template', icon: 'x', group: 'site', permission: 'site.manage' }],
        } as ModuleManifest,
      ],
      enabledKeys: new Set(['site']),
      permissions: new Set(['site.manage']),
      extraItems: { site: [{ key: 'site.collection.articles', href: '/site/c/articles', icon: 'list', group: 'site', permission: 'site.view', label: 'Artikel' }] },
    });
    const site = groups.find((g) => g.key === 'site')!;
    expect(site.items.map((i) => i.href)).toEqual(['/site/template', '/site/c/articles']);
    expect(site.items.at(-1)!.label).toBe('Artikel');
  });
});

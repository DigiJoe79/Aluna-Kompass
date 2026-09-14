import { coreModule, defineModule, type ModuleManifest } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { activeRailKey, buildNavigation, buildRail, crumbsFor, locate, sectionsFor, type NavGroup, type NavItem } from '@/lib/navigation';

const finance = defineModule({
  key: 'finance',
  version: '0.1.0',
  permissions: ['finance.view'],
  navigation: [{ key: 'finance.ledger', href: '/finance', icon: 'euro', group: 'finance', permission: 'finance.view' }],
});

/** Ein Eintrag, wie `buildNavigation` ihn baut — sichtbar, es sei denn, der Test sagt anders. */
const item = (key: string, href: string, icon = 'list', extra: Partial<NavItem> = {}): NavItem => ({
  key,
  href,
  icon,
  labelKey: `nav.${key}`,
  disabled: false,
  visible: true,
  ...extra,
});

/** Eine Installation mit Verwaltung, Einrichtung, Webseite (mit Sammlung) und Akte. */
const FIXTURE: NavGroup[] = [
  { key: 'admin', labelKey: 'nav.groups.admin', disabled: false, items: [item('users', '/admin/users', 'users'), item('media', '/admin/media', 'image')] },
  { key: 'config', labelKey: 'nav.groups.config', disabled: false, items: [item('settings', '/admin/settings', 'sliders'), item('themes', '/admin/themes', 'droplet'), item('dms.admin', '/admin/dms', 'folder')] },
  {
    key: 'site',
    labelKey: 'nav.groups.site',
    disabled: false,
    icon: 'globe',
    items: [item('site.template', '/site/template', 'layout-template'), item('site.c.artikel', '/site/c/artikel', 'list', { label: 'Artikel' })],
  },
  { key: 'dms', labelKey: 'nav.groups.dms', disabled: false, items: [item('dms.list', '/dms', 'file')] },
];

describe('buildNavigation', () => {
  /**
   * Elf Einträge in einer Gruppe waren zu viel, und die Hälfte davon stellt man
   * einmal ein statt sie zu benutzen. Deshalb zwei Gruppen: Arbeitsflächen und
   * Einrichtung.
   */
  it('trennt Arbeitsflächen von Einrichtung', () => {
    const groups = buildNavigation({ manifests: [coreModule], enabledKeys: new Set(['core']), permissions: new Set(['users.manage', 'audit.view']) });
    const admin = groups.find((g) => g.key === 'admin')!;
    const config = groups.find((g) => g.key === 'config')!;
    expect(admin.items.map((i) => i.key)).toEqual(['users', 'roles', 'audit', 'retention', 'media', 'backup']);
    expect(config.items.map((i) => i.key)).toEqual(['settings', 'locales', 'themes', 'modules', 'documents']);
    expect(admin.items.filter((i) => i.visible).map((i) => i.key)).toEqual(['users', 'audit']);
  });

  it('hängt die Verwaltungsfläche eines Moduls in die Einrichtung', () => {
    const akte = defineModule({
      key: 'akte',
      version: '0.1.0',
      permissions: ['akte.manage'],
      adminNavigation: [{ key: 'akte.admin', href: '/admin/akte', icon: 'folder', permission: 'akte.manage' }],
    });
    const groups = buildNavigation({ manifests: [coreModule, akte], enabledKeys: new Set(['core', 'akte']), permissions: new Set(['akte.manage']) });
    const config = groups.find((g) => g.key === 'config')!;
    expect(config.items.map((i) => i.key)).toContain('akte.admin');
    // Ein ausgeschaltetes Modul hängt nichts ein.
    const off = buildNavigation({ manifests: [coreModule, akte], enabledKeys: new Set(['core']), permissions: new Set(['akte.manage']) });
    expect(off.find((g) => g.key === 'config')!.items.map((i) => i.key)).not.toContain('akte.admin');
  });

  /**
   * Die Projekte waren bis zum 2026-09-12 ein Kerneintrag mit eigener Gruppe;
   * seither sind sie ein Modul wie jedes andere und hängen als Gruppe daran.
   */
  it('offers the projects as a module group, hidden without the permission', () => {
    const projects = defineModule({
      key: 'projects',
      version: '0.1.0',
      permissions: ['projects.view'],
      navigation: [{ key: 'projects.list', href: '/projects', icon: 'folder', group: 'projects', permission: 'projects.view' }],
    });
    const groups = buildNavigation({ manifests: [coreModule, projects], enabledKeys: new Set(['core', 'projects']), permissions: new Set(['projects.view']) });
    expect(groups.find((g) => g.key === 'core')).toBeUndefined();
    expect(groups.find((g) => g.key === 'projects')!.items.map((i) => [i.key, i.href, i.visible])).toEqual([['projects.list', '/projects', true]]);
    const none = buildNavigation({ manifests: [coreModule, projects], enabledKeys: new Set(['core', 'projects']), permissions: new Set() });
    expect(none.find((g) => g.key === 'projects')!.items.every((i) => !i.visible)).toBe(true);
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

  it('carries the module icon on the group so the rail can show it', () => {
    const site = defineModule({
      key: 'site',
      version: '0.1.0',
      permissions: ['site.manage'],
      moduleIcon: 'globe',
      navigation: [{ key: 'site.template', href: '/site/template', icon: 'layout-template', group: 'site', permission: 'site.manage' }],
    });
    const groups = buildNavigation({ manifests: [coreModule, site, finance], enabledKeys: new Set(['core', 'site', 'finance']), permissions: new Set(['site.manage', 'finance.view']) });
    expect(groups.find((g) => g.key === 'site')!.icon).toBe('globe');
    expect(groups.find((g) => g.key === 'finance')!.icon).toBeUndefined();
    expect(groups.find((g) => g.key === 'admin')!.icon).toBeUndefined();
  });
});

describe('locate', () => {
  it('matches at a segment boundary, not by raw prefix', () => {
    expect(locate(FIXTURE, '/dms')!.item.key).toBe('dms.list');
    expect(locate(FIXTURE, '/dms/01J')!.item.key).toBe('dms.list');
    expect(locate(FIXTURE, '/dmsx')).toBeNull();
  });

  it('prefers the longest matching entry', () => {
    const hit = locate(FIXTURE, '/site/c/artikel/neu')!;
    expect(hit.item.key).toBe('site.c.artikel');
    expect(hit.area).toBe('site');
  });

  it('maps admin and config to the settings area', () => {
    expect(locate(FIXTURE, '/admin/themes')!.area).toBe('settings');
    expect(locate(FIXTURE, '/admin/dms')!.group.key).toBe('config');
  });

  it('ignores entries the user may not see', () => {
    const hidden: NavGroup[] = [{ ...FIXTURE[3]!, items: [item('dms.list', '/dms', 'file', { visible: false })] }];
    expect(locate(hidden, '/dms')).toBeNull();
  });

  it('finds nothing on the home page and the profile', () => {
    expect(locate(FIXTURE, '/')).toBeNull();
    expect(locate(FIXTURE, '/profile')).toBeNull();
  });
});

describe('activeRailKey', () => {
  it('names the rail entry for the path', () => {
    expect(activeRailKey(FIXTURE, '/')).toBe('home');
    expect(activeRailKey(FIXTURE, '/site/c/artikel')).toBe('site');
    expect(activeRailKey(FIXTURE, '/admin/themes')).toBe('settings');
    expect(activeRailKey(FIXTURE, '/profile')).toBeNull();
  });
});

describe('buildRail', () => {
  it('lists home, one row per module, then settings behind them', () => {
    expect(buildRail(FIXTURE).map((e) => [e.key, e.href, e.icon, e.labelKey])).toEqual([
      ['home', '/', 'home', 'nav.home'],
      ['site', '/site/template', 'globe', 'nav.groups.site'],
      ['dms', '/dms', 'file', 'nav.groups.dms'],
      ['settings', '/admin/users', 'settings', 'nav.settingsArea'],
    ]);
  });

  it('falls back to the first visible item icon when the module names none', () => {
    const groups: NavGroup[] = [{ key: 'dms', labelKey: 'nav.groups.dms', disabled: false, items: [item('dms.list', '/dms', 'file')] }];
    expect(buildRail(groups).find((e) => e.key === 'dms')!.icon).toBe('file');
  });

  it('leaves out a module whose entries are all hidden, and points settings at the first visible entry', () => {
    const groups: NavGroup[] = [
      { key: 'admin', labelKey: 'nav.groups.admin', disabled: false, items: [item('users', '/admin/users', 'users', { visible: false }), item('media', '/admin/media', 'image')] },
      { key: 'config', labelKey: 'nav.groups.config', disabled: false, items: [item('themes', '/admin/themes', 'droplet', { visible: false })] },
      { key: 'dms', labelKey: 'nav.groups.dms', disabled: false, items: [item('dms.list', '/dms', 'file', { visible: false })] },
    ];
    expect(buildRail(groups).map((e) => [e.key, e.href])).toEqual([
      ['home', '/'],
      ['settings', '/admin/media'],
    ]);
  });

  it('has no settings entry when neither admin nor config shows anything', () => {
    const groups: NavGroup[] = [
      { key: 'admin', labelKey: 'nav.groups.admin', disabled: false, items: [item('users', '/admin/users', 'users', { visible: false })] },
      { key: 'config', labelKey: 'nav.groups.config', disabled: false, items: [] },
      { key: 'dms', labelKey: 'nav.groups.dms', disabled: false, items: [item('dms.list', '/dms', 'file')] },
    ];
    expect(buildRail(groups).map((e) => e.key)).toEqual(['home', 'dms']);
  });
});

describe('sectionsFor', () => {
  it('gives a module one section without heading, visible entries only', () => {
    const groups: NavGroup[] = [{ ...FIXTURE[2]!, items: [...FIXTURE[2]!.items, item('site.publish', '/site/publish', 'upload', { visible: false })] }];
    const sections = sectionsFor(groups, '/site/c/artikel');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.labelKey).toBeUndefined();
    expect(sections[0]!.items.map((i) => i.key)).toEqual(['site.template', 'site.c.artikel']);
  });

  it('gives settings two headed sections and drops an empty one', () => {
    expect(sectionsFor(FIXTURE, '/admin/themes').map((s) => [s.key, s.labelKey, s.items.length])).toEqual([
      ['admin', 'nav.groups.admin', 2],
      ['config', 'nav.groups.config', 3],
    ]);
    const onlyConfig: NavGroup[] = [{ ...FIXTURE[0]!, items: [item('users', '/admin/users', 'users', { visible: false })] }, FIXTURE[1]!];
    expect(sectionsFor(onlyConfig, '/admin/themes').map((s) => s.key)).toEqual(['config']);
  });

  it('is empty on the home page, the profile and unknown paths', () => {
    expect(sectionsFor(FIXTURE, '/')).toEqual([]);
    expect(sectionsFor(FIXTURE, '/profile')).toEqual([]);
    expect(sectionsFor(FIXTURE, '/nirgends')).toEqual([]);
  });
});

describe('crumbsFor', () => {
  const t = (key: string) =>
    ({
      'nav.home': 'Startseite',
      'nav.profile': 'Profil',
      'nav.settingsArea': 'Einstellungen',
      'nav.groups.admin': 'Verwaltung',
      'nav.groups.config': 'Einrichtung',
      'nav.groups.site': 'Webseite',
      'nav.groups.dms': 'Akte',
      'nav.themes': 'Themes',
      'nav.site.template': 'Template',
      'nav.dms.list': 'Akte',
    })[key] ?? key;

  it('names home and profile with one segment', () => {
    expect(crumbsFor(FIXTURE, '/', t)).toEqual(['Startseite']);
    expect(crumbsFor(FIXTURE, '/profile/tokens', t)).toEqual(['Profil']);
  });

  it('names module and page, using the data label when there is one', () => {
    expect(crumbsFor(FIXTURE, '/site/template', t)).toEqual(['Webseite', 'Template']);
    expect(crumbsFor(FIXTURE, '/site/c/artikel', t)).toEqual(['Webseite', 'Artikel']);
  });

  it('collapses module and page when they read the same', () => {
    expect(crumbsFor(FIXTURE, '/dms/01J', t)).toEqual(['Akte']);
  });

  it('gives settings three segments', () => {
    expect(crumbsFor(FIXTURE, '/admin/themes', t)).toEqual(['Einstellungen', 'Einrichtung', 'Themes']);
  });

  it('is empty when nothing matches', () => {
    expect(crumbsFor(FIXTURE, '/nirgends', t)).toEqual([]);
  });
});

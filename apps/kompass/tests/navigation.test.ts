import { coreModule, defineModule, type HandbookChapter, type ModuleManifest } from '@kompass/core';
import { dmsModule } from '@kompass/module-dms';
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
    expect(admin.items.map((i) => i.key)).toEqual(['users', 'roles', 'audit', 'retention', 'backup']);
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

  /**
   * Die Mediathek ist kein Verwaltungspunkt, den man einmal einstellt, sondern
   * Werkzeug im Tagesgeschäft jedes Moduls. Seit dem 2026-09-14 ist sie ein
   * eigener Bereich: nach den Modulen, direkt über der Trennlinie der Schiene.
   */
  it('offers the media library as its own area after the modules, not under administration', () => {
    const groups = buildNavigation({ manifests: [coreModule, finance], enabledKeys: new Set(['core', 'finance']), permissions: new Set(['media.upload', 'finance.view']) });
    expect(groups.map((g) => g.key)).toEqual(['admin', 'config', 'finance', 'media']);
    const media = groups.find((g) => g.key === 'media')!;
    expect(media.labelKey).toBe('nav.groups.media');
    expect(media.items.map((i) => [i.key, i.href, i.icon, i.labelKey, i.visible])).toEqual([['media', '/admin/media', 'image', 'nav.media', true]]);
    const without = buildNavigation({ manifests: [coreModule], enabledKeys: new Set(['core']), permissions: new Set() });
    expect(without.find((g) => g.key === 'media')!.items[0]!.visible).toBe(false);
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

  it('shows an item when one of several permissions is held', () => {
    const m = defineModule({ key: 'm', version: '0', permissions: ['m.view', 'm.area'], navigation: [{ key: 'm.list', href: '/m', icon: 'file', permission: ['m.view', 'm.area'] }] });
    const item = (perms: string[]) => buildNavigation({ manifests: [m], enabledKeys: new Set(['m']), permissions: new Set(perms) }).find((g) => g.key === 'm')!.items[0]!;
    expect([item(['m.area']).visible, item([]).visible]).toEqual([true, false]);
  });

  it('shows the file module to someone who holds only an area permission', () => {
    const groups = buildNavigation({ manifests: [coreModule, dmsModule], enabledKeys: new Set(['dms']), permissions: new Set(['probe.read']), extraItems: { dms: [{ key: 'dms.list', href: '/dms', icon: 'file', group: 'dms', permission: ['dms.view', 'probe.read'] }] } });
    expect(groups.find((g) => g.key === 'dms')!.items[0]!.visible).toBe(true);
  });

  it('maps a new booking and a single booking to the journal entry, not by raw prefix', () => {
    const groups: NavGroup[] = [{ key: 'finance', labelKey: 'nav.groups.finance', disabled: false, items: [item('finance.entries', '/finance/entries', 'euro')] }];
    expect(locate(groups, '/finance/entries/new')!.item.key).toBe('finance.entries');
    expect(locate(groups, '/finance/entries/01J9X')!.item.key).toBe('finance.entries');
    expect(locate(groups, '/finance/entriesx')).toBeNull();
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

  it('places the media library right before settings and keeps it out of the settings area', () => {
    const groups = buildNavigation({ manifests: [coreModule, finance], enabledKeys: new Set(['core', 'finance']), permissions: new Set(['media.upload', 'finance.view', 'users.manage']) });
    expect(buildRail(groups).map((e) => e.key)).toEqual(['home', 'finance', 'media', 'settings']);
    expect(activeRailKey(groups, '/admin/media')).toBe('media');
    expect(activeRailKey(groups, '/admin/users')).toBe('settings');
    expect(sectionsFor(groups, '/admin/users').flatMap((s) => s.items.map((i) => i.key))).not.toContain('media');
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

  /**
   * Eine Spalte mit einem Eintrag wiederholt nur die Schiene („Hunde“ unter
   * „Tiere“) und kostet 208 px. Erst ab zwei sichtbaren Einträgen gibt es
   * etwas zu wählen — die Spalte erscheint, wenn ein Modul wächst.
   */
  it('shows no second level while an area has fewer than two visible entries', () => {
    expect(sectionsFor(FIXTURE, '/dms/01J')).toEqual([]);
    const site: NavGroup[] = [{ ...FIXTURE[2]!, items: [FIXTURE[2]!.items[0]!, item('site.c.artikel', '/site/c/artikel', 'list', { visible: false })] }];
    expect(sectionsFor(site, '/site/template')).toEqual([]);
    // Auch Einstellungen: ein einziges Verwaltungsrecht ergibt keine Spalte.
    const oneRight: NavGroup[] = [
      { ...FIXTURE[0]!, items: [item('backup', '/admin/backup', 'database')] },
      { ...FIXTURE[1]!, items: [item('themes', '/admin/themes', 'droplet', { visible: false })] },
    ];
    expect(sectionsFor(oneRight, '/admin/backup')).toEqual([]);
  });

  it('groups a module’s entries by section, in order of first appearance, headed by nav.sections.<key>', () => {
    const groups: NavGroup[] = [
      {
        key: 'finance',
        labelKey: 'nav.groups.finance',
        disabled: false,
        items: [
          item('finance.entries', '/finance/entries', 'euro', { section: 'finance.entries' }),
          item('finance.accounts', '/finance/accounts', 'euro', { section: 'finance.entries' }),
          item('finance.reports', '/finance/reports', 'euro', { section: 'finance.more' }),
        ],
      },
    ];
    expect(sectionsFor(groups, '/finance/entries').map((s) => [s.key, s.labelKey, s.items.map((i) => i.key)])).toEqual([
      ['finance.entries', 'nav.sections.finance.entries', ['finance.entries', 'finance.accounts']],
      ['finance.more', 'nav.sections.finance.more', ['finance.reports']],
    ]);
  });

  it('keeps entries without a section in one headless section on top', () => {
    const groups: NavGroup[] = [
      {
        key: 'finance',
        labelKey: 'nav.groups.finance',
        disabled: false,
        items: [item('finance.entries', '/finance/entries', 'euro'), item('finance.reports', '/finance/reports', 'euro', { section: 'finance.more' })],
      },
    ];
    const sections = sectionsFor(groups, '/finance/entries');
    expect(sections.map((s) => [s.key, s.labelKey, s.items.map((i) => i.key)])).toEqual([
      ['finance', undefined, ['finance.entries']],
      ['finance.more', 'nav.sections.finance.more', ['finance.reports']],
    ]);
  });

  it('drops a section whose entries are all invisible', () => {
    const groups: NavGroup[] = [
      {
        key: 'finance',
        labelKey: 'nav.groups.finance',
        disabled: false,
        items: [
          item('finance.entries', '/finance/entries', 'euro', { section: 'finance.entries' }),
          item('finance.accounts', '/finance/accounts', 'euro', { section: 'finance.entries' }),
          item('finance.reports', '/finance/reports', 'euro', { section: 'finance.more', visible: false }),
        ],
      },
    ];
    expect(sectionsFor(groups, '/finance/entries').map((s) => s.key)).toEqual(['finance.entries']);
  });

  it('still shows no second level below two visible entries, sections or not', () => {
    const groups: NavGroup[] = [
      {
        key: 'finance',
        labelKey: 'nav.groups.finance',
        disabled: false,
        items: [item('finance.entries', '/finance/entries', 'euro', { section: 'finance.entries' }), item('finance.reports', '/finance/reports', 'euro', { section: 'finance.more', visible: false })],
      },
    ];
    expect(sectionsFor(groups, '/finance/entries')).toEqual([]);
  });

  it('carries section from the manifest into the NavItem', () => {
    const financeModule = defineModule({
      key: 'finance',
      version: '0.1.0',
      permissions: ['finance.read'],
      navigation: [{ key: 'finance.entries', href: '/finance/entries', icon: 'euro', group: 'finance', permission: 'finance.read', section: 'finance.entries' }],
    });
    const groups = buildNavigation({ manifests: [coreModule, financeModule], enabledKeys: new Set(['core', 'finance']), permissions: new Set(['finance.read']) });
    expect(groups.find((g) => g.key === 'finance')!.items[0]!.section).toBe('finance.entries');
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
      'nav.themes': 'Erscheinungsbild',
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
    expect(crumbsFor(FIXTURE, '/admin/themes', t)).toEqual(['Einstellungen', 'Einrichtung', 'Erscheinungsbild']);
  });

  it('is empty when nothing matches', () => {
    expect(crumbsFor(FIXTURE, '/nirgends', t)).toEqual([]);
  });

  const chapters: HandbookChapter[] = [
    { title: 'Akte', pages: [{ doc: 'akte/post-ablegen', title: 'Post ablegen' }] },
    { title: 'Mediathek', pages: [{ doc: 'mediathek', title: 'Mediathek' }] },
  ];

  it('names help pages by chapter and title, collapsing a chapter that is its own page', () => {
    const th = (key: string) => (key === 'nav.help' ? 'Hilfe' : t(key));
    expect(crumbsFor(FIXTURE, '/help', th, chapters)).toEqual(['Hilfe']);
    expect(crumbsFor(FIXTURE, '/help/akte/post-ablegen', th, chapters)).toEqual(['Hilfe', 'Akte', 'Post ablegen']);
    expect(crumbsFor(FIXTURE, '/help/mediathek', th, chapters)).toEqual(['Hilfe', 'Mediathek']);
    expect(crumbsFor(FIXTURE, '/help/gibt-es-nicht', th, chapters)).toEqual(['Hilfe']);
  });
});

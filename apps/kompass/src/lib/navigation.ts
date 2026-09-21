import type { HandbookChapter, ModuleManifest, NavigationItem, PermissionSpec } from '@kompass/core';

export function hasAnyOf(permissions: ReadonlySet<string>, spec?: PermissionSpec): boolean {
  if (spec === undefined) return true;
  return typeof spec === 'string' ? permissions.has(spec) : spec.some((key) => permissions.has(key));
}

export interface NavItem {
  key: string;
  href: string;
  icon: string;
  labelKey: string;
  /** Beschriftung aus Daten; hat Vorrang vor `labelKey`. */
  label?: string;
  permission?: PermissionSpec;
  disabled: boolean;
  visible: boolean;
  /** Trennlinie oberhalb dieses Eintrags. */
  sectionBreak?: boolean;
  /** Abschnitt der Zweitebene; Beschriftung aus `nav.sections.<section>`. Ohne Abschnitt: kopflos, oben. */
  section?: string;
}

export interface NavGroup {
  key: string;
  labelKey: string;
  disabled: boolean;
  items: NavItem[];
  /** Symbol des Moduls in der Schiene (`moduleIcon` des Manifests); fehlt bei `admin`/`config`. */
  icon?: string;
}

/**
 * Arbeitsflächen: Dinge, die man benutzt. Elf Einträge in einer Gruppe waren zu
 * viel, und die Hälfte davon stellt man einmal ein, statt damit zu arbeiten.
 */
const CORE_ADMIN: { key: string; href: string; icon: string; permission?: PermissionSpec }[] = [
  { key: 'users', href: '/admin/users', icon: 'users', permission: 'users.manage' },
  { key: 'roles', href: '/admin/roles', icon: 'shield', permission: 'roles.manage' },
  { key: 'audit', href: '/admin/audit', icon: 'clock', permission: 'audit.view' },
  { key: 'retention', href: '/admin/retention', icon: 'hourglass', permission: 'retention.view' },
  { key: 'backup', href: '/admin/backup', icon: 'database', permission: 'backup.export' },
];

/** Einrichtung: Dinge, die man einstellt. Module hängen ihre Stammdaten hier ein. */
const CORE_CONFIG: { key: string; href: string; icon: string; permission?: PermissionSpec }[] = [
  { key: 'settings', href: '/admin/settings', icon: 'sliders', permission: 'settings.manage' },
  { key: 'locales', href: '/admin/locales', icon: 'languages', permission: 'settings.manage' },
  { key: 'themes', href: '/admin/themes', icon: 'droplet', permission: 'settings.manage' },
  { key: 'modules', href: '/admin/modules', icon: 'grid', permission: 'modules.manage' },
  { key: 'documents', href: '/admin/documents', icon: 'file-text', permission: 'documents.export' },
];

export function buildNavigation(input: {
  manifests: readonly ModuleManifest[];
  enabledKeys: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
  /** Zur Laufzeit ermittelte Einträge je Modul-Key — etwa je Sammlung eines Templates. */
  extraItems?: Record<string, NavigationItem[]>;
}): NavGroup[] {
  const visible = (permission?: PermissionSpec) => hasAnyOf(input.permissions, permission);
  const admin: NavGroup = {
    key: 'admin',
    labelKey: 'nav.groups.admin',
    disabled: false,
    items: CORE_ADMIN.map((item) => ({ ...item, labelKey: `nav.${item.key}`, disabled: false, visible: visible(item.permission) })),
  };
  const config: NavGroup = {
    key: 'config',
    labelKey: 'nav.groups.config',
    disabled: false,
    items: [
      ...CORE_CONFIG.map((item) => ({ ...item, labelKey: `nav.${item.key}`, disabled: false, visible: visible(item.permission) })),
      ...input.manifests
        .filter((m) => m.key !== 'core' && input.enabledKeys.has(m.key))
        .flatMap((m) => m.adminNavigation ?? [])
        .map((item) => ({
          key: item.key,
          href: item.href,
          icon: item.icon,
          labelKey: `nav.${item.key}`,
          label: item.label,
          permission: item.permission,
          disabled: false,
          visible: visible(item.permission),
        })),
    ],
  };
  // Inaktive Module erscheinen gar nicht in der Navigation. Wer sie einschalten
  // will, tut das unter Verwaltung → Module; ihre Seiten zeigen bis dahin die
  // „Modul inaktiv“-Seite, falls jemand die URL direkt aufruft.
  const modules: NavGroup[] = input.manifests
    .filter(
      (m) =>
        m.key !== 'core' &&
        input.enabledKeys.has(m.key) &&
        ((m.navigation?.length ?? 0) > 0 || (input.extraItems?.[m.key]?.length ?? 0) > 0),
    )
    .map((m) => {
      const toItem = (item: NavigationItem): NavItem => ({
        key: item.key,
        href: item.href,
        icon: item.icon,
        labelKey: `nav.${item.key}`,
        label: item.label,
        permission: item.permission,
        disabled: false,
        visible: visible(item.permission),
        sectionBreak: item.sectionBreak ?? false,
        section: item.section,
      });
      return {
        key: m.key,
        labelKey: `nav.groups.${m.key}`,
        disabled: false,
        items: [...(m.navigation ?? []).map(toItem), ...(input.extraItems?.[m.key] ?? []).map(toItem)],
        icon: m.moduleIcon,
      };
    });
  // Die Mediathek ist kein Verwaltungspunkt, den man einmal einstellt, sondern
  // Werkzeug im Tagesgeschäft jedes Moduls. Deshalb ein eigener Bereich nach
  // den Modulen — in der Schiene direkt über der Trennlinie. Die Route bleibt
  // `/admin/media`; nur der Weg dorthin ändert sich.
  const media: NavGroup = {
    key: 'media',
    labelKey: 'nav.groups.media',
    disabled: false,
    icon: 'image',
    items: [{ key: 'media', href: '/admin/media', icon: 'image', labelKey: 'nav.media', permission: 'media.upload', disabled: false, visible: visible('media.upload') }],
  };
  return [admin, config, ...modules, media];
}

/** Die beiden Kerngruppen, die in der Schiene als ein Bereich „Einstellungen“ erscheinen. */
const SETTINGS_GROUPS: ReadonlySet<string> = new Set(['admin', 'config']);

export interface Location {
  /** Modul-Key, oder 'settings' für admin/config. */
  area: string;
  group: NavGroup;
  item: NavItem;
}

/** Ein `href` passt an der Segmentgrenze: `/dms` trifft `/dms` und `/dms/x`, nicht `/dmsx`. */
export function matches(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Die eine Ortsbestimmung der Schale: der längste sichtbare Eintrag, der auf
 * den Pfad passt. Schiene, Zweitebene und Brotkrume leiten sich alle daraus ab,
 * damit sie nie auseinanderlaufen.
 */
export function locate(groups: NavGroup[], pathname: string): Location | null {
  let best: Location | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      if (!item.visible || !matches(item.href, pathname)) continue;
      if (best && item.href.length <= best.item.href.length) continue;
      best = { area: SETTINGS_GROUPS.has(group.key) ? 'settings' : group.key, group, item };
    }
  }
  return best;
}

/** Welcher Eintrag der Schiene markiert ist: 'home' auf '/', sonst der Bereich des Treffers. */
export function activeRailKey(groups: NavGroup[], pathname: string): string | null {
  if (pathname === '/') return 'home';
  return locate(groups, pathname)?.area ?? null;
}

/** Ein Eintrag der Schiene: ein Bereich, nicht eine Seite. */
export interface RailEntry {
  /** Modul-Key, 'home' oder 'settings'. */
  key: string;
  href: string;
  /** Key aus der ICONS-Whitelist in `rail.tsx`. */
  icon: string;
  /** 'nav.home' | 'nav.groups.<key>' | 'nav.settingsArea' */
  labelKey: string;
}

const firstVisible = (group: NavGroup): NavItem | undefined => group.items.find((i) => i.visible);

/**
 * Eine Zeile je Bereich: Startseite, dann jedes Modul mit mindestens einem
 * sichtbaren Eintrag, zuletzt Einstellungen — und die nur, wenn Verwaltung oder
 * Einrichtung etwas Sichtbares haben. Kein festes `/admin`: Wer nur
 * `media.upload` hat, landete sonst auf einer verbotenen Seite.
 */
export function buildRail(groups: NavGroup[]): RailEntry[] {
  const rail: RailEntry[] = [{ key: 'home', href: '/', icon: 'home', labelKey: 'nav.home' }];
  for (const group of groups) {
    if (SETTINGS_GROUPS.has(group.key)) continue;
    const first = firstVisible(group);
    if (!first) continue;
    rail.push({ key: group.key, href: first.href, icon: group.icon ?? first.icon, labelKey: group.labelKey });
  }
  const settingsTarget = ['admin', 'config']
    .map((key) => groups.find((g) => g.key === key))
    .map((group) => (group ? firstVisible(group) : undefined))
    .find((entry) => entry !== undefined);
  if (settingsTarget) rail.push({ key: 'settings', href: settingsTarget.href, icon: 'settings', labelKey: 'nav.settingsArea' });
  return rail;
}

/** Ein Abschnitt der Zweitebene; die Überschrift fehlt, wenn ein Bereich nur einen hat. */
export interface NavSection {
  key: string;
  labelKey?: string;
  /** Nur sichtbare Einträge. */
  items: NavItem[];
}

const visibleItems = (group: NavGroup): NavItem[] => group.items.filter((i) => i.visible);

/**
 * Die Abschnitte der Zweitebene zum Pfad: Einstellungen zeigt Verwaltung und
 * Einrichtung mit Überschrift, ein Modul einen Abschnitt ohne. Leer heißt:
 * keine Zweitebene, die Spalte entfällt.
 */
/**
 * Gruppiert die sichtbaren Einträge eines Moduls nach `section`, in der
 * Reihenfolge ihres ersten Auftretens. Einträge ohne Abschnitt bilden einen
 * kopflosen Abschnitt (Schlüssel des Bereichs selbst, keine Beschriftung).
 */
function sectionsByGroup(group: NavGroup): NavSection[] {
  const items = visibleItems(group);
  const order: string[] = [];
  const bucket = new Map<string, NavItem[]>();
  for (const item of items) {
    const sectionKey = item.section ?? '';
    if (!bucket.has(sectionKey)) {
      bucket.set(sectionKey, []);
      order.push(sectionKey);
    }
    bucket.get(sectionKey)!.push(item);
  }
  return order.map((sectionKey) =>
    sectionKey === '' ? { key: group.key, items: bucket.get(sectionKey)! } : { key: sectionKey, labelKey: `nav.sections.${sectionKey}`, items: bucket.get(sectionKey)! },
  );
}

export function sectionsFor(groups: NavGroup[], pathname: string): NavSection[] {
  const hit = locate(groups, pathname);
  if (!hit) return [];
  const sections: NavSection[] =
    hit.area === 'settings'
      ? ['admin', 'config']
          .map((key) => groups.find((g) => g.key === key))
          .filter((group): group is NavGroup => group !== undefined && visibleItems(group).length > 0)
          .map((group) => ({ key: group.key, labelKey: group.labelKey, items: visibleItems(group) }))
      : sectionsByGroup(hit.group);
  // Ein einzelner Eintrag wiederholt nur die Schiene und kostet 208 px. Erst
  // ab zwei gibt es etwas zu wählen — die Spalte erscheint, wenn ein Bereich wächst.
  const count = sections.reduce((n, section) => n + section.items.length, 0);
  return count < 2 ? [] : sections;
}

/**
 * Die Brotkrume der Kopfleiste. Das letzte Segment ist das `<h1>` der Seite.
 * Heißen Modul und Seite gleich (Kontakte / Kontakte), bleibt ein Segment.
 */
/**
 * Die Brotkrume der Kopfleiste. Das letzte Segment ist das `<h1>` der Seite.
 * Heißen Modul und Seite gleich (Kontakte / Kontakte), bleibt ein Segment.
 * Unter `/help` kommen Kapitel und Titel aus dem Inhaltsverzeichnis.
 */
export function crumbsFor(groups: NavGroup[], pathname: string, t: (key: string) => string, helpChapters: HandbookChapter[] = []): string[] {
  if (pathname === '/') return [t('nav.home')];
  if (matches('/profile', pathname)) return [t('nav.profile')];
  if (matches('/help', pathname)) {
    const doc = pathname.slice('/help/'.length);
    for (const chapter of helpChapters) {
      const page = chapter.pages.find((p) => p.doc === doc);
      if (page) return page.title === chapter.title ? [t('nav.help'), page.title] : [t('nav.help'), chapter.title, page.title];
    }
    return [t('nav.help')];
  }
  const hit = locate(groups, pathname);
  if (!hit) return [];
  const page = hit.item.label ?? t(hit.item.labelKey);
  const area = t(hit.group.labelKey);
  if (hit.area === 'settings') return [t('nav.settingsArea'), area, page];
  return page === area ? [page] : [area, page];
}

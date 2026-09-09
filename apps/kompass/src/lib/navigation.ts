import type { ModuleManifest, NavigationItem } from '@kompass/core';

export interface NavItem {
  key: string;
  href: string;
  icon: string;
  labelKey: string;
  /** Beschriftung aus Daten; hat Vorrang vor `labelKey`. */
  label?: string;
  permission?: string;
  disabled: boolean;
  visible: boolean;
}

export interface NavGroup {
  key: string;
  labelKey: string;
  disabled: boolean;
  items: NavItem[];
}

/**
 * Kerneinträge ausserhalb der Verwaltung. Die Projekte gehören dem Kern und
 * hingen bis zum Cutover an der Navigation des Webseiten-Moduls.
 */
const CORE_MAIN: { key: string; href: string; icon: string; permission?: string }[] = [
  { key: 'projects', href: '/projects', icon: 'folder', permission: 'projects.view' },
];

const CORE_ADMIN: { key: string; href: string; icon: string; permission?: string }[] = [
  { key: 'users', href: '/admin/users', icon: 'users', permission: 'users.manage' },
  { key: 'roles', href: '/admin/roles', icon: 'shield', permission: 'roles.manage' },
  { key: 'settings', href: '/admin/settings', icon: 'sliders', permission: 'settings.manage' },
  { key: 'locales', href: '/admin/locales', icon: 'languages', permission: 'settings.manage' },
  { key: 'themes', href: '/admin/themes', icon: 'droplet', permission: 'settings.manage' },
  { key: 'modules', href: '/admin/modules', icon: 'grid', permission: 'modules.manage' },
  { key: 'audit', href: '/admin/audit', icon: 'clock', permission: 'audit.view' },
  { key: 'documents', href: '/admin/documents', icon: 'file-text', permission: 'documents.view' },
  { key: 'media', href: '/admin/media', icon: 'image', permission: 'media.upload' },
  { key: 'backup', href: '/admin/backup', icon: 'database', permission: 'backup.export' },
];

export function buildNavigation(input: {
  manifests: readonly ModuleManifest[];
  enabledKeys: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
  /** Zur Laufzeit ermittelte Einträge je Modul-Key — etwa je Sammlung eines Templates. */
  extraItems?: Record<string, NavigationItem[]>;
}): NavGroup[] {
  const visible = (permission?: string) => !permission || input.permissions.has(permission);
  const admin: NavGroup = {
    key: 'admin',
    labelKey: 'nav.groups.admin',
    disabled: false,
    items: CORE_ADMIN.map((item) => ({ ...item, labelKey: `nav.${item.key}`, disabled: false, visible: visible(item.permission) })),
  };
  const core: NavGroup = {
    key: 'core',
    labelKey: 'nav.groups.core',
    disabled: false,
    items: CORE_MAIN.map((item) => ({ ...item, labelKey: `nav.${item.key}`, disabled: false, visible: visible(item.permission) })),
  };
  // Inaktive Module erscheinen gar nicht in der Navigation. Wer sie einschalten
  // will, tut das unter Verwaltung → Module; ihre Seiten zeigen bis dahin die
  // „Modul inaktiv"-Seite, falls jemand die URL direkt aufruft.
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
      });
      return {
        key: m.key,
        labelKey: `nav.groups.${m.key}`,
        disabled: false,
        items: [...(m.navigation ?? []).map(toItem), ...(input.extraItems?.[m.key] ?? []).map(toItem)],
      };
    });
  return [core, admin, ...modules];
}

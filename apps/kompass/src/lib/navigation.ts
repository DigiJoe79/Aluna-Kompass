import type { ModuleManifest } from '@kompass/core';

export interface NavItem {
  key: string;
  href: string;
  icon: string;
  labelKey: string;
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

const CORE_ADMIN: { key: string; href: string; icon: string; permission?: string }[] = [
  { key: 'users', href: '/admin/users', icon: 'users', permission: 'users.manage' },
  { key: 'roles', href: '/admin/roles', icon: 'shield', permission: 'roles.manage' },
  { key: 'settings', href: '/admin/settings', icon: 'sliders', permission: 'settings.manage' },
  { key: 'locales', href: '/admin/locales', icon: 'languages', permission: 'settings.manage' },
  { key: 'themes', href: '/admin/themes', icon: 'droplet', permission: 'settings.manage' },
  { key: 'modules', href: '/admin/modules', icon: 'grid', permission: 'modules.manage' },
  { key: 'audit', href: '/admin/audit', icon: 'clock', permission: 'audit.view' },
  { key: 'documents', href: '/admin/documents', icon: 'file-text', permission: 'documents.view' },
  { key: 'backup', href: '/admin/backup', icon: 'database', permission: 'backup.export' },
];

export function buildNavigation(input: { manifests: readonly ModuleManifest[]; enabledKeys: ReadonlySet<string>; permissions: ReadonlySet<string> }): NavGroup[] {
  const visible = (permission?: string) => !permission || input.permissions.has(permission);
  const admin: NavGroup = {
    key: 'admin',
    labelKey: 'nav.groups.admin',
    disabled: false,
    items: CORE_ADMIN.map((item) => ({ ...item, labelKey: `nav.${item.key}`, disabled: false, visible: visible(item.permission) })),
  };
  const modules: NavGroup[] = input.manifests
    .filter((m) => m.key !== 'core' && (m.navigation?.length ?? 0) > 0)
    .map((m) => {
      const enabled = input.enabledKeys.has(m.key);
      return {
        key: m.key,
        labelKey: `nav.groups.${m.key}`,
        disabled: !enabled,
        items: (m.navigation ?? []).map((item) => ({
          key: item.key,
          href: item.href,
          icon: item.icon,
          labelKey: `nav.${item.key}`,
          permission: item.permission,
          disabled: !enabled,
          visible: visible(item.permission),
        })),
      };
    });
  return [admin, ...modules];
}

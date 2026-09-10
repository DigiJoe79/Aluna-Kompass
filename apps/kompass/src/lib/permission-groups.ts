import type { ModuleManifest } from '@kompass/core';

export interface PermissionGroup {
  key: string;
  labelKey: string;
  keys: string[];
}

const CORE_GROUPS: { key: string; keys: string[] }[] = [
  { key: 'core.admin', keys: ['users.manage', 'roles.manage', 'settings.manage', 'modules.manage'] },
  { key: 'core.accountability', keys: ['audit.view', 'retention.view'] },
  { key: 'core.data', keys: ['documents.export', 'media.upload', 'backup.export', 'backup.import'] },
  { key: 'core.projects', keys: ['projects.view', 'projects.manage'] },
];

export function groupPermissions(manifests: readonly ModuleManifest[]): PermissionGroup[] {
  const groups: PermissionGroup[] = CORE_GROUPS.map((g) => ({ key: g.key, labelKey: `permissions.groups.${g.key}`, keys: [...g.keys] }));
  for (const m of manifests) {
    if (m.key === 'core') continue;
    groups.push({ key: m.key, labelKey: `permissions.groups.${m.key}`, keys: [...m.permissions] });
  }
  return groups;
}

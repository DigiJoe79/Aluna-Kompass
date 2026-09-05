import type { ModuleManifest, SettingDefinition } from './manifest';

export interface Registry {
  manifests: readonly ModuleManifest[];
  permissionKeys: ReadonlySet<string>;
  settingDefinitions: ReadonlyMap<string, SettingDefinition>;
  module(key: string): ModuleManifest | undefined;
}

export function createRegistry(manifests: readonly ModuleManifest[]): Registry {
  const byKey = new Map<string, ModuleManifest>();
  const permissionKeys = new Set<string>();
  const settingDefinitions = new Map<string, SettingDefinition>();

  for (const manifest of manifests) {
    if (byKey.has(manifest.key)) throw new Error(`duplicate module key: ${manifest.key}`);
    byKey.set(manifest.key, manifest);
    for (const key of manifest.permissions) {
      if (permissionKeys.has(key)) throw new Error(`duplicate permission key: ${key}`);
      permissionKeys.add(key);
    }
    for (const setting of manifest.settings ?? []) {
      if (settingDefinitions.has(setting.key)) throw new Error(`duplicate setting key: ${setting.key}`);
      settingDefinitions.set(setting.key, setting);
    }
  }

  return {
    manifests,
    permissionKeys,
    settingDefinitions,
    module: (key) => byKey.get(key),
  };
}

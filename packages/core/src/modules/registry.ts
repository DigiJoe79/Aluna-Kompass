import type { DocumentTemplate, ModuleManifest, SettingDefinition } from './manifest';

export interface Registry {
  manifests: readonly ModuleManifest[];
  permissionKeys: ReadonlySet<string>;
  settingDefinitions: ReadonlyMap<string, SettingDefinition>;
  documentTemplates: ReadonlyMap<string, DocumentTemplate>;
  module(key: string): ModuleManifest | undefined;
}

export function createRegistry(
  manifests: readonly ModuleManifest[],
  extra: { coreTemplates?: readonly DocumentTemplate[] } = {},
): Registry {
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

  const documentTemplates = new Map<string, DocumentTemplate>();
  const addTemplate = (t: DocumentTemplate) => {
    if (documentTemplates.has(t.key)) throw new Error(`duplicate document template: ${t.key}`);
    documentTemplates.set(t.key, t);
  };
  for (const t of extra.coreTemplates ?? []) addTemplate(t);
  for (const manifest of manifests) for (const t of manifest.documentTemplates ?? []) addTemplate(t);

  return {
    manifests,
    permissionKeys,
    settingDefinitions,
    documentTemplates,
    module: (key) => byKey.get(key),
  };
}

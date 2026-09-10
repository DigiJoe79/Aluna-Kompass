import { z } from 'zod';
import type { CallContext } from '../context';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { conflict, notFound, ok, type Result } from '../result';
import { readSetting, writeSettingInternal } from '../settings/service';
import { validate } from '../validate';
import type { ModuleManifest } from './manifest';

export const CORE_MODULE_KEY = 'core';

export interface ModuleStatus {
  key: string;
  version: string;
  enabled: boolean;
  locked: boolean;
  dependsOn: string[];
}

function enabledKeys(deps: Deps): Set<string> {
  return new Set([CORE_MODULE_KEY, ...readSetting<string[]>(deps, 'modules.enabled')]);
}

export function isModuleEnabled(deps: Deps, key: string): boolean {
  return enabledKeys(deps).has(key);
}

export function enabledManifests(deps: Deps): ModuleManifest[] {
  const keys = enabledKeys(deps);
  return deps.registry.manifests.filter((m) => keys.has(m.key));
}

export function listModules(deps: Deps): ModuleStatus[] {
  const keys = enabledKeys(deps);
  return deps.registry.manifests.map((m) => ({
    key: m.key,
    version: m.version,
    enabled: keys.has(m.key),
    locked: m.key === CORE_MODULE_KEY,
    dependsOn: [...(m.dependsOn ?? [])],
  }));
}

const setEnabledSchema = z.object({ key: z.string().min(1), enabled: z.boolean() });

export async function setModuleEnabled(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ModuleStatus>> {
  const denied = requirePermission(ctx, 'modules.manage');
  if (denied) return denied;
  const parsed = validate(deps, setEnabledSchema, input);
  if (!parsed.ok) return parsed;
  const { key, enabled } = parsed.value;
  const manifest = deps.registry.module(key);
  if (!manifest) return notFound('module', key);
  if (key === CORE_MODULE_KEY) return conflict('moduleLocked', 'Der Kern kann nicht deaktiviert werden');
  const current = enabledKeys(deps);
  if (enabled) {
    const missing = (manifest.dependsOn ?? []).filter((dep) => !current.has(dep));
    if (missing.length > 0) return conflict('moduleDependencyInactive', `Benötigt aktive Module: ${missing.join(', ')}`);
    const activeManifests = deps.registry.manifests.filter((m) => current.has(m.key) && m.key !== key);
    for (const role of manifest.contactRoles ?? []) {
      for (const active of activeManifests) {
        if ((active.contactRoles ?? []).some((r) => r.key === role.key)) {
          return conflict('contactRoleConflict', `Rolle „${role.key}“ kollidiert zwischen ${active.key} und ${manifest.key}`);
        }
      }
    }
  } else {
    const dependents = deps.registry.manifests.filter((m) => current.has(m.key) && (m.dependsOn ?? []).includes(key));
    if (dependents.length > 0) return conflict('moduleRequiredByOthers', `Wird benötigt von: ${dependents.map((m) => m.key).join(', ')}`);
  }
  const next = [...current].filter((k) => k !== CORE_MODULE_KEY && k !== key);
  if (enabled) next.push(key);
  next.sort();
  return deps.db.transaction((tx) => {
    const written = writeSettingInternal(tx, deps, ctx, 'modules.enabled', next, enabled ? 'modules.enable' : 'modules.disable');
    if (!written.ok) return written;
    return ok(listModules(deps).find((m) => m.key === key) as ModuleStatus);
  });
}

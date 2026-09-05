import type { z } from 'zod';
import type { Deps } from '../deps';

export interface SettingDefinition<T = unknown> {
  key: string;
  schema: z.ZodType<T>;
  default: T;
  /** Nur vom System schreibbar (Import, Export); im Admin lesbar, nicht editierbar. */
  systemOnly?: boolean;
}

export interface NavigationItem {
  key: string;
  href: string;
  icon: string;
  /** Gruppen-Key; ohne Gruppe erscheint der Eintrag ungruppiert oben. */
  group?: string;
  /** Recht, das zum Anzeigen nötig ist. */
  permission?: string;
}

export interface PublishedView<T = unknown> {
  name: string;
  schema: z.ZodType<T>;
  load(deps: Deps): T[];
}

export interface ModuleManifest {
  key: string;
  version: string;
  permissions: readonly string[];
  settings?: readonly SettingDefinition[];
  navigation?: readonly NavigationItem[];
  dependsOn?: readonly string[];
  publishedViews?: readonly PublishedView[];
}

const MODULE_KEY = /^[a-z][a-z0-9-]*$/;
const PERMISSION_KEY = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

export function defineModule(manifest: ModuleManifest): ModuleManifest {
  if (!MODULE_KEY.test(manifest.key)) throw new Error(`invalid module key: ${manifest.key}`);
  for (const key of manifest.permissions) {
    if (!PERMISSION_KEY.test(key)) throw new Error(`invalid permission key: ${key}`);
  }
  return manifest;
}

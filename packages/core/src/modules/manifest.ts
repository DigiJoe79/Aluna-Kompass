import type { z } from 'zod';
import type { CallContext } from '../context';
import type { Deps } from '../deps';
import type { Result } from '../result';
import type { Theme } from '../themes/tokens';

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

export interface DocumentRenderContext {
  number: string;
  issuedAt: string;
  organization: Record<string, unknown>;
  theme: Theme;
  /** Bytes und MIME-Typ des aktiven Logos, falls vorhanden. */
  logo: { bytes: Uint8Array; mimeType: string } | null;
}

export interface DocumentTemplate<T = unknown> {
  key: string;
  /** Drei Großbuchstaben, z. B. BRF; Teil der Dokumentnummer. */
  prefix: string;
  schema: z.ZodType<T>;
  /** Zusätzliches Recht neben documents.create, z. B. finance.edit. */
  permission?: string;
  render(data: T, ctx: DocumentRenderContext): Promise<Uint8Array>;
}

export interface McpToolDefinition<T = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<T>;
  handler(deps: Deps, ctx: CallContext, args: T): Promise<Result<unknown>>;
}

export interface ModuleManifest {
  key: string;
  version: string;
  permissions: readonly string[];
  settings?: readonly SettingDefinition[];
  navigation?: readonly NavigationItem[];
  dependsOn?: readonly string[];
  publishedViews?: readonly PublishedView[];
  documentTemplates?: readonly DocumentTemplate[];
  mcpTools?: readonly McpToolDefinition[];
}

const MODULE_KEY = /^[a-z][a-z0-9-]*$/;
const PERMISSION_KEY = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;
const TEMPLATE_KEY = /^[a-z][a-z0-9-]*$/;
const TEMPLATE_PREFIX = /^[A-Z]{3}$/;

export function defineModule(manifest: ModuleManifest): ModuleManifest {
  if (!MODULE_KEY.test(manifest.key)) throw new Error(`invalid module key: ${manifest.key}`);
  for (const key of manifest.permissions) {
    if (!PERMISSION_KEY.test(key)) throw new Error(`invalid permission key: ${key}`);
  }
  for (const template of manifest.documentTemplates ?? []) {
    if (!TEMPLATE_KEY.test(template.key)) throw new Error(`invalid document template key: ${template.key}`);
    if (!TEMPLATE_PREFIX.test(template.prefix)) throw new Error(`invalid document template prefix: ${template.prefix}`);
  }
  return manifest;
}

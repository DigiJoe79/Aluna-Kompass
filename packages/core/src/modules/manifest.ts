import type { z } from 'zod';
import type { CallContext } from '../context';
import type { Deps } from '../deps';
import type { Result } from '../result';
import { RETENTION_CLASSES, type RetentionClass } from '../retention/classes';
import type { Theme } from '../themes/tokens';

export interface SettingDefinition<T = unknown> {
  key: string;
  schema: z.ZodType<T>;
  default: T;
  /** Nur vom System schreibbar (Import, Export); im Admin lesbar, nicht editierbar. */
  systemOnly?: boolean;
}

export interface MediaReference {
  /** Menschlich lesbar, für die Fehlermeldung und die Verwendungs-Spalte:
   *  z. B. 'Tier „Rocky"', 'Artikel „Sommerfest"', 'Logo des Vereins'. */
  label: string;
  /** Entitätstyp und ID, falls die Oberfläche verlinken will. */
  entity: string;
  id: string;
}

export interface RetentionHold {
  /** Menschlich lesbar, für die Anzeige und die Fehlermeldung:
   *  'Zuwendungsbestätigung BST-2026-0042', 'Adoptionsvertrag für „Rocky"'. */
  label: string;
  /** ISO-Datum, bis zu dem gehalten wird; null = dauerhaft. */
  until: string | null;
  entity: string;
  id: string;
}

export interface DueItem {
  entity: string;
  id: string;
  label: string;
  /** ISO-Datum, seit wann fällig. */
  dueSince: string;
}

/** Eine Kontaktrolle, die ein Modul beisteuert, samt ihrer Aufbewahrungsklasse. */
export interface ContactRoleDefinition {
  key: string;
  retention: RetentionClass;
}

export interface NavigationItem {
  key: string;
  href: string;
  icon: string;
  /** Gruppen-Key; ohne Gruppe erscheint der Eintrag ungruppiert oben. */
  group?: string;
  /** Recht, das zum Anzeigen nötig ist. */
  permission?: string;
  /** Beschriftung aus Daten. Fehlt sie, kommt der Text aus `nav.<key>`. */
  label?: string;
  /** Trennlinie oberhalb dieses Eintrags — teilt eine Gruppe in Abschnitte. */
  sectionBreak?: boolean;
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

export type DocumentBody = { markdown: string } | { typst: string };

export interface DocumentSlots {
  /** Bestimmt, welche Felder die Basis-Vorlage füllt. */
  kind: 'letter' | 'report' | 'form' | 'plain';
  /** Vorschau eines Entwurfs: die Basis zeichnet ein Wasserzeichen. */
  draft?: boolean;
  title?: string;
  subtitle?: string;
  /** „Ort, Datum" — Vorgabe: organization.city + ausgestellt am. */
  place?: string;
  /** Mehrzeiliges Anschriftenfeld (Brief). */
  recipient?: string;
  /** „Betreff" (Brief). */
  subject?: string;
}

export interface DocumentBuildResult {
  /** Überschreibt die Vorgabe-Basis der Vorlage; sonst gilt `DocumentTemplate.base`. */
  base?: string;
  slots: DocumentSlots;
  body: DocumentBody;
}

export interface DocumentTemplate<T = unknown> {
  key: string;
  /** Schlüssel der Dokumentart. Sie trägt Nummernpräfix und Fristklasse. */
  type: string;
  schema: z.ZodType<T>;
  /** Zusätzliches Recht neben documents.export, z. B. audit.view. */
  permission?: string;
  /** Vorgabe-Basis, wenn `build` keine nennt und keine Einstellung greift. */
  base: string;
  /**
   * Akteneintrag (Vorgabe) oder Ad-hoc-Auszug. Ein Akteneintrag — Brief,
   * Vertrag, Bescheinigung — bekommt eine lückenlose Nummer, eine Zeile in
   * `documents` und eine Ablage in der Mediathek. Ein Auszug wie das
   * Änderungsprotokoll entsteht auf Nachfrage, wird heruntergeladen und
   * hinterlässt nur einen Eintrag im Änderungsprotokoll: `filed: false`.
   */
  filed?: boolean;
  /**
   * Erzeugt Slots und Körper aus den geprüften Daten. Rein über (data, ctx):
   * keine Uhr, kein Zufall, keine I/O. Determinismus hängt daran.
   */
  build(data: T, ctx: DocumentRenderContext): DocumentBuildResult;
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
  mcpTools?: readonly McpToolDefinition[] | ((deps: Deps) => readonly McpToolDefinition[]);
  /** Einträge, die erst zur Laufzeit feststehen — etwa je Sammlung eines Templates. */
  navigationFor?: (deps: Deps) => NavigationItem[];
  /** Wo dieses Modul ein Medium verwendet — synchron, nur lesend, ohne
   *  Rechteprüfung. Befragt vor dem Löschen eines Assets. */
  mediaReferences?: (deps: Deps, assetId: string) => readonly MediaReference[];
  /** Was dieses Modul festhält — synchron, nur lesend, ohne Rechteprüfung.
   *  Befragt vor dem Löschen und für den Fristenbildschirm. `entityType` ist
   *  generisch: derselbe Haken trägt später Dokumente und Belege. */
  retentionHolds?: (deps: Deps, entityType: string, id: string) => readonly RetentionHold[];
  /** Was bei diesem Modul zur Löschung fällig ist. */
  retentionDue?: (deps: Deps) => readonly DueItem[];
  /** Kontaktrollen, die dieses Modul beisteuert. */
  contactRoles?: readonly ContactRoleDefinition[];
  /** Beispieldaten für die Entwicklungsumgebung. */
  seed?: (deps: Deps, ctx: CallContext) => Promise<void>;
}

/** Die MCP-Werkzeuge eines Moduls, egal ob als feste Liste oder als Funktion von `deps` deklariert. */
export const moduleMcpTools = (deps: Deps, manifest: ModuleManifest): readonly McpToolDefinition[] =>
  typeof manifest.mcpTools === 'function' ? manifest.mcpTools(deps) : (manifest.mcpTools ?? []);

const MODULE_KEY = /^[a-z][a-z0-9-]*$/;
const PERMISSION_KEY = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;
const TEMPLATE_KEY = /^[a-z][a-z0-9-]*$/;
const TEMPLATE_TYPE = /^[a-z][a-z0-9-]*$/;
const ROLE_KEY = /^[a-z][a-z0-9-]*$/;

export function defineModule(manifest: ModuleManifest): ModuleManifest {
  if (!MODULE_KEY.test(manifest.key)) throw new Error(`invalid module key: ${manifest.key}`);
  for (const key of manifest.permissions) {
    if (!PERMISSION_KEY.test(key)) throw new Error(`invalid permission key: ${key}`);
  }
  for (const template of manifest.documentTemplates ?? []) {
    if (!TEMPLATE_KEY.test(template.key)) throw new Error(`invalid document template key: ${template.key}`);
    if (!TEMPLATE_TYPE.test(template.type)) throw new Error(`invalid document type: ${template.type}`);
  }
  for (const role of manifest.contactRoles ?? []) {
    if (!ROLE_KEY.test(role.key)) throw new Error(`invalid contact role key: ${role.key}`);
    if (!RETENTION_CLASSES.includes(role.retention)) throw new Error(`invalid contact role retention class: ${role.retention}`);
  }
  return manifest;
}

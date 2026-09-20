import type { z } from 'zod';
import type { CallContext } from '../context';
import { dashboardOptionFields, type DashboardTile } from '../dashboard/types';
import type { DbOrTx } from '../db/client';
import { validateDeletionRules, type DeletionRule } from '../deletion-policy';
import type { Deps } from '../deps';
import { CORE_PERMISSIONS } from '../permissions/core';
import type { Result } from '../result';
import { RETENTION_CLASSES, type RetentionClass } from '../retention/classes';
import type { Theme } from '../themes/tokens';

/** Text je Sprache oder Liste kurzer Begriffe je Sprache — die zwei Formen von `localizedText` und `localizedList`. */
export type LocalizedValue = string | string[];

/** Ein Datensatz mit seinen mehrsprachigen Feldern, wie ein Modul ihn dem Kern für die Übersetzungsliste meldet. */
export interface Translatable {
  entityType: string;
  id: string;
  /** Tiername, Projektname, Slug — für die Liste, die ein Client dem Menschen zeigt. */
  label: string;
  /** Der Weg zur Maske, z. B. `/animals/<id>`. */
  href: string;
  /** Feldpfad (`summary`, `story.quote`, `faq[2].answer`) → Wert je Sprache. */
  fields: Record<string, Record<string, LocalizedValue>>;
  /** Sprachen, in denen dieser Datensatz ausgespielt wird. Fehlt die Angabe, gelten die der Installation. */
  locales?: readonly string[];
}

/** Alle Übersetzungen eines Datensatzes, die der Kern in einem Aufruf an das Modul gibt. */
export interface TranslationWrite {
  entityType: string;
  id: string;
  items: { field: string; locale: string; text: LocalizedValue }[];
}

export interface SettingDefinition<T = unknown> {
  key: string;
  schema: z.ZodType<T>;
  default: T;
  /** Nur vom System schreibbar (Import, Export); im Admin lesbar, nicht editierbar. */
  systemOnly?: boolean;
}

export interface MediaReference {
  /** Menschlich lesbar, für die Fehlermeldung und die Verwendungs-Spalte:
   *  z. B. 'Tier „Rocky“', 'Artikel „Sommerfest“', 'Logo des Vereins'. */
  label: string;
  /** Entitätstyp und ID, falls die Oberfläche verlinken will. */
  entity: string;
  id: string;
  /** Der Weg zur Fundstelle in der Oberfläche; weggelassen, wenn es keine Seite gibt. Muster wie `FollowUpTarget.href`. */
  href?: string;
  /**
   * Das Recht, unter dem dieses Asset steht. Gesetzt heißt: Die Datei gehört
   * einem Datensatz, den nicht jeder sehen darf, und `getMediaAsset` liefert
   * sie nur mit diesem Recht aus. Ohne Angabe bleibt es beim Bisherigen —
   * Arbeitsmaterial, das jede angemeldete Person lesen kann.
   */
  permission?: string;
}

/** Eine Stelle, die auf einen fremden Datensatz zeigt. Form wie `MediaReference`. */
export interface RecordReference {
  /** Menschlich lesbar, für die Fehlermeldung und den Löschdialog:
   *  'Dokument BST-2026-0042', 'Wiedervorlage „Impfpass nachfragen“'. */
  label: string;
  entity: string;
  id: string;
  /** Der Weg zur Fundstelle; weggelassen, wenn es keine Seite gibt. */
  href?: string;
}

export interface RetentionHold {
  /** Menschlich lesbar, für die Anzeige und die Fehlermeldung:
   *  'Zuwendungsbestätigung BST-2026-0042', 'Adoptionsvertrag für „Rocky“'. */
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

/** Wie ein Modul eine Entität für die Wiedervorlage-Liste beschriftet. */
export interface FollowUpTarget {
  label: string;
  /** Der Weg zur Entität; `null`, wenn es keine Seite dafür gibt. */
  href: string | null;
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
  /** „Ort, Datum“ — Vorgabe: organization.city + ausgestellt am. */
  place?: string;
  /** Mehrzeiliges Anschriftenfeld (Brief). */
  recipient?: string;
  /** „Betreff“ (Brief). */
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
  /**
   * Der Service, den `handler` ruft — als Referenz, nicht als Name. Der
   * Paritätstest der App vergleicht damit mechanisch: jeder Service eines
   * Moduls muss von mindestens einem Werkzeug genannt werden. Fehlt das Feld,
   * gilt das Werkzeug als „ruft keinen Service“ — und fällt im Test auf,
   * sobald ein Service ohne Werkzeug bleibt.
   */
  service?: (...args: never[]) => unknown;
}

/** Welche Handbuchseite zu einer Route gehört. Der Kern kennt keine Routen; die App wertet das aus. */
export interface HelpEntry {
  /** Routenpräfix, an der Segmentgrenze verglichen wie die Navigation. */
  href: string;
  /** Pfad der Handbuchseite ohne `.md`, relativ zu `docs/handbuch/`: 'akte/post-ablegen'. */
  doc: string;
}

export interface ModuleManifest {
  key: string;
  version: string;
  permissions: readonly string[];
  settings?: readonly SettingDefinition[];
  navigation?: readonly NavigationItem[];
  /**
   * Symbol des Moduls in der Schiene. Fehlt es, nimmt die Schale das Icon des
   * ersten sichtbaren Navigationseintrags. Muss wie `NavigationItem.icon` in
   * der ICONS-Whitelist von `apps/kompass/src/components/shell/rail.tsx` stehen.
   */
  moduleIcon?: string;
  /** Hilfe je Route des Moduls. Längster `href` gewinnt. */
  help?: readonly HelpEntry[];
  /**
   * Die Verwaltungsfläche des Moduls — Stammdaten, die ein Admin pflegt. Die
   * Schale entscheidet, wo sie erscheint; das Modul sagt nur, dass es eine hat.
   * Ohne diese Deklaration müsste der Kern für jedes künftige Modul mit
   * Stammdaten angefasst werden.
   */
  adminNavigation?: readonly NavigationItem[];
  dependsOn?: readonly string[];
  publishedViews?: readonly PublishedView[];
  documentTemplates?: readonly DocumentTemplate[];
  mcpTools?: readonly McpToolDefinition[] | ((deps: Deps) => readonly McpToolDefinition[]);
  /** Einträge, die erst zur Laufzeit feststehen — etwa je Sammlung eines Templates. */
  navigationFor?: (deps: Deps) => NavigationItem[];
  /** Wo dieses Modul ein Medium verwendet — synchron, nur lesend, ohne
   *  Rechteprüfung. Befragt vor dem Löschen eines Assets. */
  mediaReferences?: (deps: Deps, assetId: string) => readonly MediaReference[];
  /** Wo dieses Modul auf einen fremden Datensatz zeigt — synchron, nur lesend,
   *  ohne Rechteprüfung. Befragt vor dem Löschen des Datensatzes. Anders als
   *  `retentionHolds` fragt der Haken nicht nach Fristen: Jeder Verweis zählt. */
  recordReferences?: (deps: Deps, entityType: string, id: string) => readonly RecordReference[];
  /**
   * Ein fremder Datensatz wurde gelöscht — in dieser Transaktion. Das Modul
   * räumt mit, was nur an ihm hing (Finanzfelder eines Projekts ohne Buchung),
   * und protokolliert es. Richtung Kern → Modul, nur eingeschaltete Module.
   * **Was ein Modul hier mitlöscht, meldet es nicht über `recordReferences`**:
   * Ein Verweis blockiert das Löschen, dann käme dieser Haken nie an die Reihe.
   */
  recordDeleted?: (tx: DbOrTx, deps: Deps, ctx: CallContext, entityType: string, id: string) => void;
  /**
   * Dieses Modul legt eigene Dateien ab. Es bekommt dann `<dataPath>/<key>`
   * über `deps.files(key)`. Die Anmeldung ist nicht Form, sondern Zweck: Das
   * Backup sichert genau die angemeldeten Verzeichnisse.
   */
  files?: boolean;
  /**
   * Verzeichnisse im eigenen Speicher, die **bereitgestelltes Material** sind
   * und kein Bestand: Sie gehören ins Backup, überleben aber ein Zurücksetzen.
   * Pfade relativ zum Modulverzeichnis, z. B. `['template']`.
   */
  providedFiles?: readonly string[];
  /** Was dieses Modul festhält — synchron, nur lesend, ohne Rechteprüfung.
   *  Befragt vor dem Löschen und für den Fristenbildschirm. `entityType` ist
   *  generisch: derselbe Haken trägt später Dokumente und Belege. */
  retentionHolds?: (deps: Deps, entityType: string, id: string) => readonly RetentionHold[];
  /** Was bei diesem Modul zur Löschung fällig ist. */
  retentionDue?: (deps: Deps) => readonly DueItem[];
  /**
   * Beschriftung und Link für eine Entität dieses Moduls, an der eine
   * Wiedervorlage hängt. Richtung Kern → Modul, wie `retentionHolds`: Der Kern
   * fragt nach einem Namen für etwas, das das Modul besitzt. `null` heißt:
   * nicht meine Entität.
   */
  followUpTargets?: (deps: Deps, entityType: string, id: string) => FollowUpTarget | null;
  /**
   * Die mehrsprachigen Datensätze dieses Moduls, Entwürfe eingeschlossen.
   * Richtung Kern → Modul wie `followUpTargets`. Prüft das Ansichtsrecht des
   * Moduls selbst und antwortet `forbidden`, wenn es fehlt — der Kern nennt das
   * Modul dann unter `omitted`, statt die ganze Liste zu verweigern.
   */
  translatables?: (deps: Deps, ctx: CallContext) => Result<Translatable[]>;
  /**
   * Schreibt Übersetzungen eines Datensatzes über den eigenen Update-Service:
   * eine Transaktion, ein Audit-Eintrag, nur die genannten Sprachschlüssel
   * ersetzt. `null` heißt: nicht mein `entityType`.
   */
  setTranslations?: (deps: Deps, ctx: CallContext, input: TranslationWrite) => Promise<Result<unknown>> | null;
  /** Kontaktrollen, die dieses Modul beisteuert. */
  contactRoles?: readonly ContactRoleDefinition[];
  /**
   * Was von den Entitäten dieses Moduls gelöscht werden darf, und warum
   * (nicht). Prinzip 3 als Daten: `deletionPolicy(registry)` bündelt Kern und
   * Module, `defineModule` prüft jede Regel, die Registry lehnt eine Entität
   * ab, die zwei Module regeln. Ein Modul regelt nur, was ihm gehört.
   */
  deletionRules?: readonly DeletionRule[];
  /** Beispieldaten für die Entwicklungsumgebung. */
  seed?: (deps: Deps, ctx: CallContext) => Promise<void>;
  /**
   * Was dieses Modul braucht, um überhaupt benutzbar zu sein — Stammdaten, die
   * es ohne Konfiguration nicht gäbe. Läuft beim **Einschalten** des Moduls, in
   * derselben Transaktion, und gilt in jeder Umgebung; `seed` dagegen erfindet
   * Beispiele und läuft nur in `development`.
   *
   * Muss idempotent sein: Aus- und wieder Einschalten darf nichts verdoppeln.
   * Bewusst synchron, damit der Schritt mit dem Einschalten steht und fällt.
   */
  /**
   * Kacheln für die Startseite (Spec 2026-09-17). Richtung Kern → Modul wie
   * `retentionDue`: Der Kern fragt jede eingeschaltete Kachel, deren Recht der
   * Nutzer hat. Beschriftungen liegen in der Sprachdatei der App unter
   * `dashboard.tiles.<modul>.<key>`.
   */
  dashboardTiles?: readonly DashboardTile[];
  install?: (tx: DbOrTx, deps: Deps, ctx: CallContext) => void;
}

/** Die MCP-Werkzeuge eines Moduls, egal ob als feste Liste oder als Funktion von `deps` deklariert. */
export const moduleMcpTools = (deps: Deps, manifest: ModuleManifest): readonly McpToolDefinition[] =>
  typeof manifest.mcpTools === 'function' ? manifest.mcpTools(deps) : (manifest.mcpTools ?? []);

const MODULE_KEY = /^[a-z][a-z0-9-]*$/;
const PERMISSION_KEY = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;
const TEMPLATE_KEY = /^[a-z][a-z0-9-]*$/;
const TEMPLATE_TYPE = /^[a-z][a-z0-9-]*$/;
const ROLE_KEY = /^[a-z][a-z0-9-]*$/;
const TILE_KEY = /^[a-z][a-zA-Z0-9]*$/;
const TILE_KINDS: ReadonlySet<string> = new Set(['count', 'list', 'status']);

export function defineModule(manifest: ModuleManifest): ModuleManifest {
  if (!MODULE_KEY.test(manifest.key)) throw new Error(`invalid module key: ${manifest.key}`);
  for (const key of manifest.permissions) {
    if (!PERMISSION_KEY.test(key)) throw new Error(`invalid permission key: ${key}`);
  }
  for (const template of manifest.documentTemplates ?? []) {
    if (!TEMPLATE_KEY.test(template.key)) throw new Error(`invalid document template key: ${template.key}`);
    if (!TEMPLATE_TYPE.test(template.type)) throw new Error(`invalid document type: ${template.type}`);
  }
  validateDeletionRules(manifest.key, manifest.deletionRules ?? []);
  for (const role of manifest.contactRoles ?? []) {
    if (!ROLE_KEY.test(role.key)) throw new Error(`invalid contact role key: ${role.key}`);
    if (!RETENTION_CLASSES.includes(role.retention)) throw new Error(`invalid contact role retention class: ${role.retention}`);
  }
  const seenTiles = new Set<string>();
  for (const tile of manifest.dashboardTiles ?? []) {
    if (!TILE_KEY.test(tile.key)) throw new Error(`invalid dashboard tile key: ${tile.key}`);
    if (seenTiles.has(tile.key)) throw new Error(`duplicate dashboard tile: ${manifest.key}/${tile.key}`);
    seenTiles.add(tile.key);
    if (!TILE_KINDS.has(tile.kind)) throw new Error(`invalid dashboard tile kind: ${tile.kind}`);
    const own = manifest.permissions.includes(tile.permission);
    const core = (CORE_PERMISSIONS as readonly string[]).includes(tile.permission);
    if (!own && !core) throw new Error(`dashboard tile ${manifest.key}/${tile.key} names a foreign permission: ${tile.permission}`);
    dashboardOptionFields(tile.options); // wirft bei unzulässigem Schema
  }
  return manifest;
}

import type { PublishedFileSource } from '../published/files';
import type { SystemMailHook } from '../system-mail';
import type { z } from 'zod';
import { validateAuditActions, type AuditActionDef } from '../audit/actions';
import type { CallContext } from '../context';
import type { IsoDay } from '../dates';
import { dashboardOptionFields, type DashboardTile } from '../dashboard/types';
import type { DbOrTx } from '../db/client';
import { validateDeletionRules, type DeletionRule } from '../deletion-policy';
import type { Deps } from '../deps';
import type { ImageRatio } from '../media/image-place-resolve';
import { CORE_PERMISSIONS } from '../permissions/core';
import type { PermissionSpec } from '../permissions/check';
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
  /**
   * Ist dieses Modul eingeschaltet, führt es den Wert: `setSetting` (auch `settings_set`) lehnt mit `settingManaged`
   * ab, nur `writeSettingInternal` schreibt. Zwei Fälle: ein Kern-Wert, den ein Modul übernimmt (`organization.iban` →
   * `finance`), und ein eigener Wert des Moduls, den einer seiner Dienste mit eigenen Prüfungen schreibt
   * (`finance.sepa.accountId` → `finance`, Befundliste 0.4.0 K1). `apps/kompass/tests/module-settings-owned.test.ts`
   * hält die Liste vollständig.
   */
  managedBy?: string;
  /** Nur über die Kanäle `ui` und `system` änderbar, nie über `mcp`. */
  uiOnly?: boolean;
  /**
   * `'redact'`: Das Protokoll hält nur fest, dass sich der Wert geändert hat,
   * nie den Wert selbst — für Freitexte, die Namen, Beschlüsse oder Vereinbarungen
   * tragen können (AGENTS.md Prinzip 3: das Protokoll ist unlöschbar).
   */
  auditValue?: 'redact';
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
   * Zeigt die Fundstelle einen Ausschnitt des Bildes (Spec Ausschnitt für alle Bilder § 3)? Die Mediathek schreibt
   * dann „· zugeschnitten“ hinter die Verwendung; bearbeitet wird der Ausschnitt nur an der Verwendung.
   */
  cropped?: boolean;
  /**
   * Das Recht, unter dem dieses Asset steht. Gesetzt heißt: Die Datei gehört
   * einem Datensatz, den nicht jeder sehen darf, und `getMediaAsset` liefert
   * sie nur mit diesem Recht aus. Ohne Angabe bleibt es beim Bisherigen —
   * Arbeitsmaterial, das jede angemeldete Person lesen kann.
   */
  permission?: string;
}

/**
 * K2 (Rest von Befund 49): eine Bezeichnung als Schlüssel der Sprachdatei samt Parametern — Werte (Nummer, Name,
 * Datum als `YYYY-MM-DD`), nie Satzstücke. Die Haken der Module liefern sie so; der Kern löst sie beim Einsammeln
 * über `Deps.labels` auf (`resolveLabel`), das die App mit der Sprachdatei belegt.
 */
export interface LabelRef {
  key: string;
  params?: Record<string, string | number>;
}
export type LabelText = string | LabelRef;
/** Eine Verwendung eines SEPA-Mandats, gemeldet über `mandateUsages`. */
export interface MandateUsageInput {
  kind: string;
  id: string;
  label: LabelRef;
}
/**
 * Ein offener Posten, der per Lastschrift eingezogen werden soll — gemeldet über `directDebitSources` (Plan L2). Der
 * Betrag ist der noch offene Rest, `remittance` der Verwendungszweck (die Zahlungsreferenz des Postens).
 */
export interface DirectDebitSourceItem {
  openItemId: string;
  mandateId: string;
  amountCents: number;
  dueOn: string;
  remittance: string;
}
/** Was ein Haken liefert: dieselbe Form, nur die Bezeichnung darf ein Schlüssel sein. */
export type WithLabelRef<T extends { label: string }> = Omit<T, 'label'> & { label: LabelText };
export type RetentionHoldInput = WithLabelRef<RetentionHold>;
export type RecordReferenceInput = WithLabelRef<RecordReference>;
export type DueItemInput = WithLabelRef<DueItem>;
export type FollowUpTargetInput = WithLabelRef<FollowUpTarget>;
export type RecordLabelInput = Omit<RecordLabel, 'label' | 'auditLabel'> & { label: LabelText; auditLabel?: LabelText };

/**
 * Ein Herkunftstyp offener Posten der Finanzen, den ein Modul anmeldet (`ModuleManifest.openItemOrigins`, Spec
 * Mitglieder und Lastschrift § 6.1). Beschriftung und Link liefert der Haken `recordLabels` des Moduls mit
 * `entityType = type`.
 */
export interface OpenItemOriginDefinition {
  type: string;
}

/** Eine Bildstelle einer Modul-Sicht (`ModuleManifest.imagePlaces`). */
export interface ImagePlaceDeclaration {
  /** `<modul>.<stelle>`, etwa `animals.primary`; so heißt sie in `images` des Templates. */
  key: string;
  /** Name der Stelle als Übersetzungsschlüssel (voller Pfad in `messages/de.json`). */
  label: string;
  /** Je Format ein Name, wenn das Template genau so viele Formate angibt (Projekt: Kachel, Titelbild). */
  labels?: readonly string[];
  /** Zeigt die Stelle das Bild zusätzlich groß wie gewählt (Lightbox der Galerie)? Schlüssel des Namens. */
  lightbox?: string;
  /** Format, wenn das Template nichts angibt — etwa die Einstellung „Bildausschnitt“ des Tier-Moduls. */
  fallback?: (deps: Deps) => ImageRatio | undefined;
}

/** Ein Fund des Haken `mediaReferences`: die Fundstelle samt dem Asset, auf das sie zeigt. */
export interface AssetMediaReference extends MediaReference {
  assetId: string;
}
/** Was der Haken `mediaReferences` liefert: dieselbe Form, die Bezeichnung als Schlüssel der Sprachdatei (K2). */
export type AssetMediaReferenceInput = WithLabelRef<AssetMediaReference>;

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
  /** Wohin der Fristenbildschirm führt — die Seite, auf der gelöscht wird. Ohne Angabe steht der Eintrag ohne Link da. */
  href?: string;
}

/** Wie ein Modul eine Entität für die Wiedervorlage-Liste beschriftet. */
export interface FollowUpTarget {
  label: string;
  /** Der Weg zur Entität; `null`, wenn es keine Seite dafür gibt. */
  href: string | null;
}

export type RecordLabelState = 'ok' | 'forbidden' | 'missing';
/** Beschriftung eines fremden Datensatzes für den, der fragt. */
export interface RecordLabel {
  /** Bei `forbidden` neutral („Kontakt (kein Zugriff)“, „ZWB-2026-0007, geschützt“), bei `missing` leer. */
  label: string;
  href: string | null;
  state: RecordLabelState;
  /**
   * Freitext zu diesem Datensatz gehört nicht ins Änderungsprotokoll — es ist
   * unlöschbar und mit `audit.view` durchsuchbar. Gilt für jeden Aufrufer; der
   * Kern lässt dann den Titel einer Wiedervorlage aus seinem Eintrag.
   */
  sensitive?: boolean;
  /** Wie das Protokoll den Datensatz nennt, wenn er heikel ist — nie mit Betreff oder Namen. Fehlt es, gilt `label`. */
  auditLabel?: string;
  /**
   * Der bloße Name ohne Art, für die Spalte „Objekt“ im Änderungsprotokoll, die die Art selbst davorsetzt
   * („Geschäftsjahr · 2026“ statt „Geschäftsjahr · Geschäftsjahr 2026“). Nur live angezeigt, nie gespeichert. Fehlt
   * er, gilt `label`; leer heißt: kein Name, nur die Art.
   */
  name?: string;
}

/**
 * `none`: Die Rolle hält ihren Kontakt nicht selbst — das Modul, das sie
 * mitbringt, hält ihn über seine Vorgänge (Buchungen, Bestätigungen). Eine
 * Klasse wäre hier falsch: Eine laufende Rolle rechnet „ab heute“ und hielte
 * für immer (Vorarbeiten-Spec V6).
 */
export type ContactRoleRetention = RetentionClass | 'none';

/** Eine Kontaktrolle, die ein Modul beisteuert, samt ihrer Aufbewahrungsklasse. */
export interface ContactRoleDefinition {
  key: string;
  retention: ContactRoleRetention;
  /**
   * Schlüssel des Moduls, das diese Rolle führt: Rolle setzt und beendet nur dieses Modul (Mitglieder: `member` läuft
   * von Eintritt bis Ende der Mitgliedschaft). Von Hand lehnen die Dienste der Kontakte sie ab.
   */
  managedBy?: string;
  /**
   * Die Rolle kann den Verein vertreten (§ 26 BGB): An ihr lässt sich „vertritt nach § 26 BGB“ festhalten
   * (`contact_roles.represents_association`); bei anderen Rollen lehnen die Dienste der Kontakte das Merkmal ab.
   */
  representation?: true;
}

export interface NavigationItem {
  key: string;
  href: string;
  icon: string;
  /** Gruppen-Key; ohne Gruppe erscheint der Eintrag ungruppiert oben. */
  group?: string;
  /** Recht, das zum Anzeigen nötig ist — bei einer Liste genügt eines. */
  permission?: PermissionSpec;
  /** Beschriftung aus Daten. Fehlt sie, kommt der Text aus `nav.<key>`. */
  label?: string;
  /** Trennlinie oberhalb dieses Eintrags — teilt eine Gruppe in Abschnitte. */
  sectionBreak?: boolean;
  /** Abschnitt der Zweitebene; Beschriftung aus `nav.sections.<section>`. Ohne Abschnitt: kopflos, oben. */
  section?: string;
  /**
   * Kommt in einer späteren Fassung (N1, Freigabe Joe 2026-10-24): ein normaler Link, gedämpft mit „später“; das
   * Ziel ist eine Zustandskarte, die sagt, was kommt.
   */
  later?: boolean;
}

/** Ein Datensatz, der veröffentlicht ist und auf eine Prüfung wartet: Beschriftung und Weg in die Oberfläche. */
export interface PendingReviewItem {
  label: string;
  href: string;
}

export interface PublishedView<T = unknown> {
  name: string;
  schema: z.ZodType<T>;
  load(deps: Deps): T[];
  /** Datensätze dieser Sicht, die veröffentlicht sind und auf eine Prüfung durch einen Menschen warten. Der Publish warnt, sperrt aber nicht. */
  pendingReview?(deps: Deps): PendingReviewItem[];
  /**
   * Wohin eine Zeile dieser Sicht in der Oberfläche führt (Bearbeiten-Adresse und Titel) — für den Sperrhinweis des Publish.
   * Die Zeile trägt nur das öffentliche Schema, keine ID; deshalb bekommt der Haken `deps` und schlägt den Datensatz selbst nach.
   * Wird nur für Treffer gefragt, nicht für jede Zeile.
   */
  editLink?(deps: Deps, row: T): { href: string; title: string } | null;
}

/** Ein Schutzbereich für Dokumentarten der Akte: ein fester Schlüssel und das Recht, das ihn öffnet. */
export interface DocumentArea {
  key: string;
  permission: string;
}

/** Zu welchen seiner Vorgänge ein Modul Dokumente der Akte ausliefert und ablegt — und unter welchem seiner Rechte. */
export interface LinkedDocumentAccess {
  entityType: string;
  readPermission: string;
  /** Fehlt es, legt das Modul zu diesem Vorgang nichts ab. */
  receivePermission?: string;
  /**
   * Der Bezug berechnet statt gespeichert (G7, Kassenprüfung): die Dokumente, die zu dem Vorgang `entityId` gehören —
   * synchron, nur lesend, ohne Rechteprüfung. Dann prüft die Akte Recht und Zugehörigkeit gegen diese Liste statt gegen
   * eine Verknüpfung; ablegen lässt sich unter einem berechneten Bezug nichts (kein `receivePermission`).
   */
  documentsOf?: (deps: Deps, entityId: string) => readonly string[];
}

export interface DocumentRenderContext {
  number: string;
  issuedAt: string;
  /**
   * Der Tag auf dem Dokument im Kalender des Vereins: `issuedOn`, sonst heute in `organization.timeZone`.
   * Papier druckt ihn über `paperDate` (K10) — nie `issuedAt`, dessen erste zehn Zeichen der UTC-Tag sind.
   */
  issuedDay: IsoDay;
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
  /**
   * Mehrzeiliges Anschriftenfeld (Brief; Formular, wenn die Basis im Manifest
   * `"slots": ["recipient", "recipientLabel", "infoBlock"]` trägt). Klartext,
   * Zeilen mit `\n` getrennt.
   */
  recipient?: string;
  /** Formular: Klartext klein in der Rücksendezeile über der Anschrift, z. B. „Name und Anschrift des Zuwendenden:“. */
  recipientLabel?: string;
  /** Formular: Typst-Markup rechts neben der Anschrift (die Basis setzt es mit `eval(…, mode: "markup")`); Freitext darin mit `typstText` absichern. */
  infoBlock?: string;
  /** „Betreff“ (Brief). */
  subject?: string;
  /** Bericht: Ausgabestufe aus dem Zustand des Jahres (Basis meldet `"slots": ["stage", …]`). */
  stage?: 'preliminary' | 'review' | 'final';
  /** Bericht: Text zur Stufe, vom Produkt — die Basis kennt keinen Inhalt. */
  stageText?: string;
  /** Kopf ohne Ausgabedatum (Basen `a4-plain`, `a4-plain-slim`). Die Nummer bleibt. */
  hideDate?: boolean;
  /** Beschriftung oben rechts statt Nummer und Datum (dieselben Basen). */
  headerLabel?: string;
  /** Vermerk klein vor der Seitenzahl, etwa „Erzeugt TT.MM.JJJJ, HH:MM · <Kurz-Hash>“. */
  footerNote?: string;
}

/** Ein Bild, das der Körper einbindet: Bytes und ihre Prüfsumme (SHA-256, vom Modul berechnet). */
export interface DocumentImage {
  bytes: Uint8Array;
  checksum: string;
}

export interface DocumentBuildResult {
  /** Überschreibt die Vorgabe-Basis der Vorlage; sonst gilt `DocumentTemplate.base`. */
  base?: string;
  slots: DocumentSlots;
  body: DocumentBody;
  /**
   * Bilder für den Körper, je Schlüssel (`[a-z0-9-]+`). Der Renderer legt sie
   * als `/images/<key>.<png|jpg>` in den Job — die Endung kommt aus den
   * Magic Bytes (`documentImagePath`). `build` bleibt rein: Bytes und
   * Prüfsumme löst das Modul vorher auf und gibt sie in der Eingabe mit. Im
   * Snapshot steht je Bild nur die Prüfsumme.
   */
  images?: Record<string, DocumentImage>;
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
   * Arbeitsflächen ohne Bereichsnavigation (N1 Gremien, Freigabe Joe 2026-10-28): Routenmuster, auf denen die Schale die
   * Zweitebene weglässt — die Schiene bleibt. Ein Segment aus einem Stern passt auf genau ein Segment (Mitlauf einer Sitzung).
   */
  workspaceRoutes?: readonly string[];
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
  /**
   * Die Basis-Vorlagen, auf denen die Dokumente des Moduls erscheinen (Befund
   * 51 b). Führt eine Installation überhaupt eigene Basen, meldet Kompass jede
   * hier genannte, die sie nicht selbst führt — sonst erschiene etwa eine
   * Zuwendungsbestätigung im Standardkopf neben Briefen im Vereinskopf.
   * Jede Basis aus `documentTemplates` steht hier (`apps/kompass/tests/document-bases.test.ts`).
   */
  documentBases?: readonly string[];
  mcpTools?: readonly McpToolDefinition[] | ((deps: Deps) => readonly McpToolDefinition[]);
  /** Einträge, die erst zur Laufzeit feststehen — etwa je Sammlung eines Templates. */
  navigationFor?: (deps: Deps) => NavigationItem[];
  /** Wo dieses Modul Medien verwendet — synchron, nur lesend, ohne
   *  Rechteprüfung. Befragt vor dem Löschen eines Assets und für die Spalte
   *  „Verwendet in“ der Mediathek. Gefragt wird für viele Assets auf einmal:
   *  Jedes Modul antwortet mit wenigen Abfragen für die ganze Menge, nicht mit
   *  einer je Asset (1546 Dateien kosteten auf dem NAS 7 s, Befund 0.2.4/10). */
  mediaReferences?: (deps: Deps, assetIds: ReadonlySet<string>) => readonly AssetMediaReferenceInput[];
  /** Wo dieses Modul auf einen fremden Datensatz zeigt — synchron, nur lesend,
   *  ohne Rechteprüfung. Befragt vor dem Löschen des Datensatzes. Anders als
   *  `retentionHolds` fragt der Haken nicht nach Fristen: Jeder Verweis zählt. */
  recordReferences?: (deps: Deps, entityType: string, id: string) => readonly RecordReferenceInput[];
  /**
   * Der Bezug als Berechtigung (Vorarbeiten-Spec V2): Wer ein hier genanntes
   * Recht hat, bekommt über die Seiten dieses Moduls genau die Dokumente, die
   * mit dessen Vorgängen verknüpft sind — ohne `dms.view`. **Die Akte prüft**
   * Recht und Bezug, nie das Modul (Prinzip 6). Ein so angemeldeter Bezugstyp
   * ist reserviert: Nur sein Modul setzt und löst solche Bezüge.
   */
  linkedDocumentAccess?: readonly LinkedDocumentAccess[];
  /**
   * Schutzbereiche, die dieses Modul für Dokumentarten anmeldet (Vorarbeiten-Spec
   * V1). Eine Art mit Bereich zeigt ihre Dokumente nur dem, der **genau** dieses
   * Recht hat. Aufgelöst wird registry-weit, auch bei ausgeschaltetem Modul —
   * sonst öffnete das Ausschalten den Bereich (V15). Label: `dms.areas.<key>`.
   */
  documentAreas?: readonly DocumentArea[];
  /**
   * Plan N2 (F7): Eigene Dokumentarten, die die Akte wie freie Dokumente stornieren darf — solange sie keinen
   * Versandvermerk tragen. Was das Modul aus ihnen ableitet (Mahnstufe, Überweisungsaufforderung), muss ein storniertes
   * Dokument ohnehin übergehen. Andere eigene Arten storniert nur das Modul selbst.
   */
  voidableDocumentTypes?: readonly string[];
  /**
   * Ein fremder Datensatz wurde gelöscht — in dieser Transaktion. Das Modul
   * räumt mit, was nur an ihm hing (Finanzfelder eines Projekts ohne Buchung),
   * und protokolliert es. Richtung Kern → Modul, nur eingeschaltete Module.
   * **Was ein Modul hier mitlöscht, meldet es nicht über `recordReferences`**:
   * Ein Verweis blockiert das Löschen, dann käme dieser Haken nie an die Reihe.
   */
  recordDeleted?: (tx: DbOrTx, deps: Deps, ctx: CallContext, entityType: string, id: string) => void;
  /**
   * Ein Dokument der Akte hat einen Versandvermerk bekommen — von Hand oder
   * durch den Mailversand, in derselben Transaktion. `sentAt` ist der Tag,
   * `channel` der Schlüssel des Versandwegs (`dms.dispatchChannels`). Ein Modul,
   * das zu dem Dokument einen eigenen Vorgang führt (Zuwendungsbestätigung,
   * Mahnstufe), hält damit seinen Versand nach; ein zweiter Vermerk darf nichts
   * überschreiben, was schon steht. Wirft der Haken, rollt der Vermerk zurück.
   */
  documentDispatched?: (tx: DbOrTx, deps: Deps, ctx: CallContext, input: { documentId: string; sentAt: string; channel: string }) => void;
  /**
   * Aufräumen im Hintergrund (Spec Vorschlags-Eingang § 7): Der Kern ruft den Haken in einem Takt für **jedes
   * installierte** Modul, auch ausgeschaltete — Fristen zum Leeren laufen weiter, wenn ein Modul ruht. Läuft mit
   * eigenem `systemContext`, darf werfen (der Takt fängt und protokolliert auf der Konsole).
   */
  housekeeping?: (deps: Deps) => Promise<void>;
  /**
   * Systemmail senden — Betreff, Text, Empfänger (Spec Backup § Meldungen). Richtung Kern → Modul: Der Kern kennt
   * keine Absender-Einstellungen (Prinzip 1), ein Modul mit Mailversand bietet ihn an. `available` sagt, ob gerade
   * gesendet werden kann (Versand eingerichtet, Absender gesetzt); `send` wirft nie. Wiederverwendbar für spätere
   * Kern-Meldungen; der Kern nimmt das erste eingeschaltete Modul, das verfügbar ist (`sendSystemMail`).
   */
  systemMail?: SystemMailHook;
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
  retentionHolds?: (deps: Deps, entityType: string, id: string) => readonly RetentionHoldInput[];
  /** Was bei diesem Modul zur Löschung fällig ist. */
  retentionDue?: (deps: Deps) => readonly DueItemInput[];
  /**
   * Zählungen für das Manifest eines Backups; Richtung Kern → Modul wie `retentionDue`. Synchron, nur lesend.
   * Schlüssel ohne Modulpräfix (`documents`); der Kern legt `<modul>.` davor.
   */
  backupCounts?: (deps: Deps) => Record<string, number>;
  /**
   * Wann dieses Modul zuletzt publiziert hat (ISO-Zeitpunkt), sonst `null`. Richtung Kern → Modul (Prinzip 1): Das
   * Einspielen eines Backups liest es vor dem Austausch, damit die Backup-Seite danach sagen kann, dass die Webseite
   * neuer ist als der eingespielte Stand. Synchron, nur lesend.
   */
  lastPublishedAt?: (deps: Deps) => string | null;
  /**
   * Eine Datei, die dieses Modul der Webseite liefert: Eine Sicht des Moduls nennt die ID unter einem Schlüssel auf
   * `…AssetId`, der Export holt die Datei hierüber (`resolvePublishedFile`). Das Modul erkennt seine IDs am Präfix und
   * liefert nur Dateien, die es selbst als öffentlich führt; sonst `null`. Synchron, nur lesend.
   */
  publishedFile?: (deps: Deps, id: string) => PublishedFileSource | null;
  /**
   * Seit wann die Zeile `views.<view>:<href>` mit ihrem heutigen Stand auf der Webseite steht (ISO-Zeitpunkt), sonst
   * `null`. Richtung Modul → Webseite: Das Webseiten-Modul beantwortet es aus seinen Publish-Läufen, ein Fachmodul
   * fragt über `publishedItemLiveSince`, ohne die Webseite zu kennen.
   */
  publishedLiveSince?: (deps: Deps, view: string, href: string) => string | null;
  /**
   * Beschriftung und Link für eine Entität dieses Moduls, an der eine
   * Wiedervorlage hängt. Richtung Kern → Modul, wie `retentionHolds`: Der Kern
   * fragt nach einem Namen für etwas, das das Modul besitzt. `null` heißt:
   * nicht meine Entität.
   */
  followUpTargets?: (deps: Deps, entityType: string, id: string) => FollowUpTargetInput | null;
  /**
   * Beschriftung und Link für einen Datensatz dieses Moduls — **mit `ctx`**
   * (wie `translatables`): Wer ihn nicht lesen darf, bekommt `forbidden` und
   * eine neutrale Beschriftung. `null` heißt: nicht meine Entität. Der Kern
   * fragt diesen Haken auch für Wiedervorlagen; `followUpTargets` bleibt als
   * Rückfall für Module, die ihn noch nicht bedienen. Nicht aus dem
   * `index.ts` des Moduls exportieren — der MCP-Paritätswächter hielte die
   * Funktion für einen Dienst.
   */
  recordLabels?: (deps: Deps, ctx: CallContext, entityType: string, id: string) => RecordLabelInput | null;
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
   * Kontaktrollen, die ein **anderes** Modul definiert und dieses Modul führt, solange es eingeschaltet ist (Gremien
   * führt `board-member` und `treasurer` der Finanzen). Ausgeschaltet bleibt die Rolle von Hand pflegbar.
   * `contactRoleManager` wertet es aus; die Registry lehnt eine Rolle ab, die zwei Module führen (`roleManagedTwice`).
   */
  managesContactRoles?: readonly string[];
  /**
   * Führt das Modul nur einen Teil der Zeilen seiner `managesContactRoles`? Dann meldet es hier, ob diese Zeile ihm
   * gehört (Gremien: die Zeilen, die eine Amtszeit trägt). Fehlt der Haken, gehören ihm alle Zeilen. Neu anlegen von
   * Hand bleibt so oder so gesperrt; `contactRoleRowManager` wertet es aus.
   */
  ownsContactRoleRow?: (deps: Deps, rowId: string) => boolean;
  /**
   * Darf dieses Modul gerade ausgeschaltet werden? Ein ausgeschaltetes Modul
   * schweigt als Halter — wer festgeschriebene Vorgänge führt, lehnt deshalb
   * ab. Rückgabe: Meldungsschlüssel unter `modules.cannotDisable.*`, oder `null`.
   */
  canDisable?: (deps: Deps) => string | null;
  /**
   * Sprachen, die dieses Modul braucht, solange es eingeschaltet ist (die Webseite: die
   * Sprachen des aktiven Templates). Richtung Kern → Modul wie `canDisable`: Der Kern
   * fragt nur eingeschaltete Module, bevor eine Sprache entfernt wird, und lehnt mit
   * `localeRequired` ab, wenn eines sie nennt. Leer, wenn das Modul nichts verlangt.
   */
  requiredLocales?: (deps: Deps) => readonly string[];
  /**
   * Was von den Entitäten dieses Moduls gelöscht werden darf, und warum
   * (nicht). Prinzip 3 als Daten: `deletionPolicy(registry)` bündelt Kern und
   * Module, `defineModule` prüft jede Regel, die Registry lehnt eine Entität
   * ab, die zwei Module regeln. Ein Modul regelt nur, was ihm gehört.
   */
  deletionRules?: readonly DeletionRule[];
  /** Aktionen des Änderungsprotokolls mit ihren Werten (Spec Protokoll § 3); `recordAudit` prüft dagegen. */
  auditActions?: Record<string, AuditActionDef>;
  /** Beispieldaten für die Entwicklungsumgebung. */
  seed?: (deps: Deps, ctx: CallContext) => Promise<void>;
  /**
   * Beispieldaten, die aus den Daten der anderen Module abgeleitet sind — läuft nach den `seed`-Haken aller Module,
   * gleich in welcher Reihenfolge die Manifeste stehen (Webseite: der festgehaltene Stand eines Beispiel-Publish).
   */
  seedLast?: (deps: Deps, ctx: CallContext) => Promise<void>;
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
  /**
   * Die Bildstellen der veröffentlichten Sichten dieses Moduls (Spec Ausschnitt für alle Bilder § 2): Stellen, an
   * denen ein Bild auf der Webseite erscheint, ohne ein Template-Feld zu sein (Hauptfoto, Projektbild). Ein Template
   * gibt ihnen unter `images[key]` Format und Breite; Kompass prüft `images` beim Einlesen gegen die Stellen der
   * eingeschalteten Module. Der Schlüssel beginnt mit dem Modulschlüssel (`animals.primary`).
   */
  imagePlaces?: readonly ImagePlaceDeclaration[];
  /**
   * Die Angaben `images` des Templates, das die Webseite baut — vom Modul, das das Template einliest (Site). Richtung
   * Kern → Modul, damit Kern und Fachmodule die Bildstellen auflösen, ohne das Site-Modul zu kennen.
   */
  imagePlaceSpecs?: (deps: Deps) => Readonly<Record<string, unknown>> | undefined;
  /**
   * Herkunftstypen offener Posten der Finanzen, die diesem Modul gehören (Spec Mitglieder und Lastschrift § 6.1).
   * Ein Posten mit so einer Herkunft entsteht, verschiebt und storniert sich nur über den Vorgang im Modul; die
   * öffentlichen Dienste der Finanzen lehnen ihn ab. Je Installation gehört jeder Typ genau einem Modul.
   */
  openItemOrigins?: readonly OpenItemOriginDefinition[];
  /**
   * Wofür ein SEPA-Mandat der Finanzen steht (Plan L1, Spec Mitglieder und Lastschrift § 7.2): die Datensätze dieses
   * Moduls, die das Mandat nutzen — etwa Mitgliedschaften mit Zahlweg Lastschrift. Die Finanzen sammeln es für
   * `usedFor`; beschriftet über einen Schlüssel der Sprachdatei, nie mit Namen.
   */
  mandateUsages?: (deps: Deps, mandateId: string) => readonly MandateUsageInput[];
  /**
   * Offene Posten dieses Moduls, die per Lastschrift eingezogen werden (Plan L2, Spec Mitglieder und Lastschrift § 7.4):
   * fällig bis `until`, mit dem Mandat, das die Vereinbarung nennt — gleich in welchem Zustand; ob eingezogen werden
   * darf, entscheidet die Vorschau des Einzugs und nennt den Grund. So kennen die Finanzen die Mitglieder nicht.
   */
  directDebitSources?: (deps: Deps, input: { until: string }) => readonly DirectDebitSourceItem[];
  /**
   * „Rückgabe klären“ → „nicht mehr einfordern“ (Plan L3): Der offene Posten dieses Moduls, den eine Rücklastschrift
   * wieder geöffnet hat, wird erlassen — auf dem Weg des Moduls (bei den Mitgliedern `waiveCharge`), in der Transaktion
   * der Finanzen. `null`: Der Posten gehört nicht diesem Modul. Ein Fehlschlag kommt als `Result` zurück.
   */
  directDebitWaive?: (tx: DbOrTx, deps: Deps, ctx: CallContext, openItemId: string) => Result<unknown> | null;
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
const IMAGE_PLACE_KEY = /^[a-z][a-z0-9-]*\.[a-z][a-zA-Z0-9]*$/;
const OPEN_ITEM_ORIGIN_TYPE = /^[a-z][A-Za-z0-9]{2,59}$/;
const TILE_KINDS: ReadonlySet<string> = new Set(['count', 'list', 'status']);
const TILE_VARIANTS: ReadonlySet<string> = new Set(['due', 'work']);

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
  validateAuditActions(manifest.auditActions ?? {});
  for (const role of manifest.contactRoles ?? []) {
    if (!ROLE_KEY.test(role.key)) throw new Error(`invalid contact role key: ${role.key}`);
    if (role.retention !== 'none' && !RETENTION_CLASSES.includes(role.retention)) throw new Error(`invalid contact role retention class: ${role.retention}`);
    if (role.managedBy !== undefined && !MODULE_KEY.test(role.managedBy)) throw new Error(`invalid contact role manager: ${role.managedBy}`);
  }
  if (manifest.managesContactRoles !== undefined) {
    if (manifest.managesContactRoles.length === 0) throw new Error(`empty managesContactRoles: ${manifest.key}`);
    if (new Set(manifest.managesContactRoles).size !== manifest.managesContactRoles.length) throw new Error(`duplicate managesContactRoles: ${manifest.key}`);
    for (const key of manifest.managesContactRoles) if (!ROLE_KEY.test(key)) throw new Error(`invalid managed contact role key: ${key}`);
  }
  const seenTiles = new Set<string>();
  for (const tile of manifest.dashboardTiles ?? []) {
    if (!TILE_KEY.test(tile.key)) throw new Error(`invalid dashboard tile key: ${tile.key}`);
    if (seenTiles.has(tile.key)) throw new Error(`duplicate dashboard tile: ${manifest.key}/${tile.key}`);
    seenTiles.add(tile.key);
    if (!TILE_KINDS.has(tile.kind)) throw new Error(`invalid dashboard tile kind: ${tile.kind}`);
    if (tile.variant !== undefined) {
      if (!TILE_VARIANTS.has(tile.variant)) throw new Error(`invalid dashboard tile variant: ${tile.variant}`);
      if (tile.kind !== 'list') throw new Error(`dashboard tile ${manifest.key}/${tile.key}: variant ${tile.variant} needs kind list`);
    }
    for (const permission of typeof tile.permission === 'string' ? [tile.permission] : tile.permission) {
      const own = manifest.permissions.includes(permission);
      const core = (CORE_PERMISSIONS as readonly string[]).includes(permission);
      if (!own && !core) throw new Error(`dashboard tile ${manifest.key}/${tile.key} names a foreign permission: ${permission}`);
    }
    dashboardOptionFields(tile.options); // wirft bei unzulässigem Schema
  }
  for (const access of manifest.linkedDocumentAccess ?? []) {
    for (const permission of [access.readPermission, access.receivePermission]) {
      if (permission && !manifest.permissions.includes(permission)) throw new Error(`linked document access ${manifest.key}/${access.entityType} names a foreign permission: ${permission}`);
    }
    if (access.documentsOf && access.receivePermission) throw new Error(`linked document access ${manifest.key}/${access.entityType} is computed and cannot receive`);
  }
  const seenPlaces = new Set<string>();
  for (const place of manifest.imagePlaces ?? []) {
    if (!IMAGE_PLACE_KEY.test(place.key) || !place.key.startsWith(`${manifest.key}.`)) throw new Error(`invalid image place key: ${manifest.key}/${place.key}`);
    if (seenPlaces.has(place.key)) throw new Error(`duplicate image place: ${place.key}`);
    seenPlaces.add(place.key);
    if (!place.label.trim()) throw new Error(`image place ${place.key} needs a label`);
  }
  for (const area of manifest.documentAreas ?? []) {
    if (!manifest.permissions.includes(area.permission)) throw new Error(`document area ${manifest.key}/${area.key} names a foreign permission: ${area.permission}`);
  }
  const seenOrigins = new Set<string>();
  for (const origin of manifest.openItemOrigins ?? []) {
    if (!OPEN_ITEM_ORIGIN_TYPE.test(origin.type)) throw new Error(`invalid open item origin type: ${manifest.key}/${origin.type}`);
    if (seenOrigins.has(origin.type)) throw new Error(`duplicate open item origin: ${manifest.key}/${origin.type}`);
    seenOrigins.add(origin.type);
  }
  return manifest;
}

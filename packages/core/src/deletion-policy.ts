import type { RetentionClass } from './retention/classes';

/**
 * Was in Kompass gelöscht werden darf — und was nicht. Kanonische Fassung von
 * Prinzip 3 (`AGENTS.md`): „Nichts Rechenschaftsrelevantes wird gelöscht."
 *
 * Diese Konstante ändert kein Laufzeitverhalten; sie ist die eine Stelle, gegen
 * die Menschen und Agenten prüfen, und ein Test hält sie konsistent. Wer eine
 * `delete*`-Funktion baut, trägt hier die Begründung ein.
 *
 * `entity` ist ein logischer Name. Wo die Entität eine eigene Tabelle hat, ist
 * er gleich dem `entityType` ihrer `recordAudit`-Aufrufe; `theme` etwa lebt als
 * Wert in der Einstellung `themes`.
 *
 * Nicht geführt: flüchtige Infrastruktur (Sitzungen), widerrufbare Tokens,
 * das Zurücksetzen einer Template-Variablen auf ihren Leerwert, und Join-Zeilen
 * ohne eigene Identität (`animal_photos`).
 */
export interface DeletionRule {
  /** Entitätstyp, wie in recordAudit als entityType verwendet. */
  entity: string;
  deletable: boolean;
  /** Ein Satz: warum (nicht). Deutsch, weil Rechenschaftsbezug. */
  reason: string;
  /** Nur bei deletable: was eine einzelne Löschung trotzdem verhindert. */
  guard?: string;
  /** Nur bei deletable: die Aktion, die ins Änderungsprotokoll geht (`bereich.verb`). */
  auditAction?: string;
  /** Nur bei deletable: die Aufbewahrungsklasse, nach deren Ablauf gelöscht werden darf. */
  retentionClass?: RetentionClass;
}

export const DELETION_POLICY: readonly DeletionRule[] = [
  // Rechenschaft — nie löschbar
  {
    entity: 'user',
    deletable: false,
    reason:
      'Der Verlauf von Nutzern, Rollen und Rechten ist rechenschaftsrelevant (Prinzip 3). Deaktivieren statt löschen.',
  },
  {
    entity: 'role',
    deletable: false,
    reason: 'Teil des Rechte-Verlaufs. Eine nicht mehr benötigte Rolle wird geleert, nicht gelöscht.',
  },
  {
    entity: 'setting',
    deletable: false,
    reason: 'Vereinsstamm, Steuerdaten und Regeln sind nachweispflichtig; Werte ändern sich, Schlüssel bleiben.',
  },
  {
    entity: 'auditEntry',
    deletable: false,
    reason: 'Das Änderungsprotokoll ist der Nachweis selbst; nur INSERT, per Trigger abgesichert.',
  },
  {
    entity: 'document',
    deletable: false,
    reason:
      'Belege und erzeugte Dokumente sind gegenüber Finanzamt und Transparenzregister nachweispflichtig; Storno statt Löschen.',
  },
  {
    entity: 'module',
    deletable: false,
    reason: 'Module werden deaktiviert; ihre Datenspuren bleiben.',
  },
  {
    entity: 'project',
    deletable: false,
    reason: 'Trägt ab Stufe 3 Finanzfelder; Löschbarkeit entscheidet sich dort (AGENTS.md).',
  },
  {
    entity: 'animal',
    deletable: false,
    reason: 'Trägt ab Stufe 4 Bestandsbuch und § 11-Nachweise; Löschbarkeit entscheidet sich dort (AGENTS.md).',
  },
  {
    entity: 'sitePublish',
    deletable: false,
    reason: 'Die Publish-Historie ist ein Betriebsprotokoll über Jahre.',
  },

  // Arbeitsmaterial — löschbar, mit Protokolleintrag
  {
    entity: 'documentDraft',
    deletable: true,
    reason:
      'Ein Entwurf ist Arbeitsmaterial: keine Nummer, keine Datei, kein Nachweis. Erst das Festschreiben macht ihn rechenschaftsrelevant.',
    guard: 'nur solange phase = draft',
    auditAction: 'dms.draft.delete',
  },
  {
    entity: 'documentFolder',
    deletable: true,
    reason: 'Nur Ordnung, kein Nachweis — wie ein Ordner der Mediathek.',
    guard: 'nur wenn leer (keine Dokumente, keine Unterordner)',
    auditAction: 'dms.folder.delete',
  },
  {
    entity: 'documentLink',
    deletable: true,
    reason: 'Ein Bezug ist eine Zuordnung, kein Vorgang. Falsch gesetzte Bezüge müssen korrigierbar sein.',
    guard: 'keiner',
    auditAction: 'dms.unlink',
  },
  {
    entity: 'documentRule',
    deletable: true,
    reason: 'Eine Regel ist Bedienkomfort, kein Nachweis.',
    guard: 'keiner',
    auditAction: 'dms.rule.delete',
  },
  {
    entity: 'siteEntry',
    deletable: true,
    reason: 'Redaktioneller Inhalt der Webseite (Prinzip 3).',
    guard: 'keiner',
    auditAction: 'site.entry.delete',
  },
  {
    entity: 'mediaAsset',
    deletable: true,
    reason: 'Arbeitsmaterial der Redaktion.',
    guard: 'nur wenn kein Datensatz mehr darauf verweist',
    auditAction: 'media.delete',
  },
  {
    entity: 'mediaFolder',
    deletable: true,
    reason: 'Nur Ordnung, kein Nachweis.',
    guard: 'nur wenn leer (keine Assets, keine Unterordner)',
    auditAction: 'media.folder.delete',
  },
  {
    entity: 'theme',
    deletable: true,
    reason: 'Gestaltung, kein Nachweis.',
    guard: 'nicht das aktive und nicht das Default-Theme',
    auditAction: 'themes.delete',
  },
  {
    entity: 'contact',
    deletable: true,
    reason:
      'Personenbezogene Daten sind nach Wegfall des Zwecks zu löschen (DSGVO Art. 17). Die gesetzliche Aufbewahrung sticht diese Pflicht nur, solange sie läuft.',
    guard: 'Erst wenn kein Halter mehr läuft — geprüft über retentionHolds aller aktiven Module. Ohne nachgewiesene Frist bleibt der Kontakt bestehen.',
    auditAction: 'contacts.delete',
  },
];

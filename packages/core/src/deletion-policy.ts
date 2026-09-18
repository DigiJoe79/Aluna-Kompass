import type { ModuleManifest } from './modules/manifest';
import type { RetentionClass } from './retention/classes';

/**
 * Was in Kompass gelöscht werden darf — und was nicht. Kanonische Fassung von
 * Prinzip 3 (`AGENTS.md`): „Nichts Rechenschaftsrelevantes wird gelöscht.“
 *
 * Jedes Manifest führt die Regeln für seine eigenen Entitäten unter
 * `deletionRules`; der Kern seine hier. `deletionPolicy(registry)` ist die
 * Summe, gegen die Menschen und Agenten prüfen. Die Regeln ändern kein
 * Laufzeitverhalten; `defineModule` hält jede einzelne konsistent, die Registry
 * verhindert, dass zwei Module dieselbe Entität regeln. Wer eine
 * `delete*`-Funktion baut, trägt die Begründung am Manifest seines Moduls ein.
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

/** Dieselbe Form wie ein Permission-Key: camelCase je Abschnitt, mindestens ein Punkt. */
const AUDIT_ACTION = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/** Wirft bei einer in sich widersprüchlichen Regel; von `defineModule` aufgerufen. */
export function validateDeletionRules(moduleKey: string, rules: readonly DeletionRule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    const where = `${moduleKey}/${rule.entity}`;
    if (seen.has(rule.entity)) throw new Error(`duplicate deletion rule: ${rule.entity} (${moduleKey})`);
    seen.add(rule.entity);
    if (rule.deletable) {
      if (!rule.guard) throw new Error(`deletable rule without guard: ${where}`);
      if (!rule.auditAction || !AUDIT_ACTION.test(rule.auditAction)) throw new Error(`deletable rule without well-formed audit action: ${where}`);
    } else {
      if (rule.guard !== undefined) throw new Error(`non-deletable rule with guard: ${where}`);
      if (rule.auditAction !== undefined) throw new Error(`non-deletable rule with audit action: ${where}`);
    }
  }
}

/** Die Löschpolitik einer Installation: der Kern plus jedes installierte Modul, aktiv oder nicht. */
export function deletionPolicy(registry: { manifests: readonly ModuleManifest[] }): DeletionRule[] {
  return registry.manifests.flatMap((m) => m.deletionRules ?? []);
}

/** Die Regeln für die Entitäten des Kerns. Fachmodule führen ihre am eigenen Manifest. */
export const CORE_DELETION_RULES: readonly DeletionRule[] = [
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
    entity: 'module',
    deletable: false,
    reason: 'Module werden deaktiviert; ihre Datenspuren bleiben.',
  },

  // Arbeitsmaterial — löschbar, mit Protokolleintrag
  {
    entity: 'followUp',
    deletable: true,
    reason: 'Eine Wiedervorlage ist ein Merkzettel am Vorgang. Der Normalweg ist Abhaken; Löschen bleibt für Versehen.',
    guard: 'keiner',
    auditAction: 'followUps.delete',
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
    entity: 'dashboardLayout',
    deletable: true,
    reason: 'Die Anordnung der eigenen Startseite ist eine Nutzereinstellung, kein Vereinsvorgang. „Vorgabe wiederherstellen“ löscht sie.',
    guard: 'nur die eigene',
    auditAction: 'dashboard.resetLayout',
  },
];

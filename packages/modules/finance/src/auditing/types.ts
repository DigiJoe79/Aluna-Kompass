/**
 * Kassenprüfung (Spec Rechenschaft 0.4.0 § D1, Finanz-Spec § 9.4): die Formen, die die Dienste unter `auditing/`
 * liefern und D1b liest. Beschriftungen baut die App aus Codes und Parametern — keine Sätze in den Diensten.
 */
export type AuditMode = 'kompass' | 'paper';
export const AUDIT_MODES = ['kompass', 'paper'] as const satisfies readonly AuditMode[];

/**
 * Die Abschnitte des Prüfpakets in Prüferreihenfolge (Finanz-Spec § 9.4). Der neunte, `resolutions` (G-30), gibt es nur,
 * wenn ein Modul die finanzwirksamen Beschlüsse liefert (Gremien eingeschaltet) — welche gelten, sagt
 * `activeAuditSectionsInternal` bzw. `AuditStatus.sections`.
 */
export type AuditSection = 'journal' | 'reconciliation' | 'vouchers' | 'imports' | 'anomalies' | 'purposesReserves' | 'donations' | 'partnerPayments' | 'resolutions';
export const AUDIT_SECTIONS = ['journal', 'reconciliation', 'vouchers', 'imports', 'anomalies', 'purposesReserves', 'donations', 'partnerPayments', 'resolutions'] as const satisfies readonly AuditSection[];

export interface AuditorAccess {
  userId: string | null;
  userActive: boolean;
  hasRole: boolean;
  lastLoginAt: string | null;
  endedAt: string | null;
  /** Die Rolle mit Herkunft `finance:auditor` gibt es nicht (umbenannt geht, gelöscht nicht) — dann zählt das Recht. */
  roleMissingOrigin: boolean;
}

export interface AuditorIndependence {
  /** Eine Vorstandsrolle (`board-member`), die das Jahr schneidet. */
  boardRole: { since: string; until: string | null } | null;
  /** Festgeschriebene Buchungen des Jahres, an denen der Kontakt steht oder die sein Nutzer freigegeben hat. */
  involvedEntryIds: string[];
}

export interface AuditorView {
  id: string;
  fiscalYearId: string;
  contactId: string;
  contactName: string;
  mode: AuditMode;
  confidential: boolean;
  confidentialityDocumentId: string | null;
  electedOn: string | null;
  minutesDocumentId: string | null;
  access: AuditorAccess;
  independence: AuditorIndependence;
  /** Vermerke, Stichproben, durchgesehene Abschnitte oder Beiträge zum Prüfbericht — dann lässt er sich nicht austragen. */
  hasWork: boolean;
  /** Für `expectedVersion` beim Bearbeiten. */
  version: string;
}

export interface AuditCashCount { countId: string; countedOn: string; countedCents: number; witnessAuditorIds: string[] }

export interface AuditStatus {
  fiscalYearId: string;
  /** Die Abschnitte dieses Jahres in Prüferreihenfolge: acht, mit Gremien neun (G-30). */
  sections: AuditSection[];
  yearStatus: 'open' | 'closed';
  /** Der jüngste Prüfstand des Jahres. */
  baseline: { id: string; createdAt: string; kind: 'initial' | 'followUp' } | null;
  /** Gegen ihn zählt „geändert“: der Prüfstand des zuletzt abgelegten Berichts, sonst der erste. */
  referenceBaselineId: string | null;
  changedEntryIds: string[];
  sectionsReviewed: { section: AuditSection; auditorIds: string[] }[];
  /** Durchsichten, die nach einer Änderung im Abschnitt nur noch für einen früheren Prüfstand gelten (Nachprüfung). */
  sectionsReviewedBefore: { section: AuditSection; auditorIds: string[]; at: string }[];
  /** „Stichproben: n von m Buchungen“ über alle Prüfer, jede Buchung einmal (Designer N4). */
  samples: { sampledEntries: number; totalEntries: number };
  /** Vermerke, die nicht geklärt sind: offen und beantwortet (nicht der Filter `state: open`). */
  remarksUnresolved: number;
  report: {
    id: string; kind: 'report' | 'followUp'; origin: 'kompass' | 'blank'; state: 'draft' | 'readyToSign' | 'filed'; scansExpected: number; scansFiled: number;
    editorNames: string[]; lastEditedAt: string | null; lastPrintedAt: string | null;
  } | null;
  followUpOpen: boolean;
  /** Eine Nachprüfung ohne geänderte Buchung, in Schritt 10 bestätigt: der Zeitpunkt, sonst `null` (Designer Runde 8, 346). */
  followUpConfirmedAt: string | null;
  /** Seit der Ablage des Prüfberichts stehen Stichproben und Durchsicht fest: der Zeitpunkt, sonst `null` (274/279). */
  workFixedSince: string | null;
  /** Prüfer „in Kompass“, deren Nutzer die Rolle Kassenprüfer noch hat (Designer 12h). */
  auditorsWithOpenAccess: number;
  /** Die letzte Zählung mit Zeugen nach dem Referenz-Prüfstand (Vorgabe des Berichts). */
  cashCount: AuditCashCount | null;
  /** Alle Zählungen mit Zeugen nach dem Referenz-Prüfstand, neueste zuerst. */
  cashCounts: AuditCashCount[];
  /** Wer die Kasse führt: aktive Nutzer mit `finance.entriesFinalize` (Designer 12f). */
  cashKeepers: string[];
  packageRun: { state: string; finishedAt: string | null; files: ('folder' | 'archive' | 'reports')[] } | null;
  /** `canEditReport`: Bearbeiter des Prüfberichts, solange die Prüfung des Jahres nicht abgeschlossen ist. */
  me: { auditorId: string | null; canEditReport: boolean };
}

export interface AuditRemarkView {
  id: string;
  kind: 'question' | 'finding';
  /** `report`: `id` ist der Katalogschlüssel des Berichts (Parameter `{ fiscalYearId }`). */
  /** `resolution`: ein Beschluss aus Abschnitt 9 (G-30), `id` ist seine Kennung. */
  target: { type: 'entry' | 'document' | 'report' | 'year' | 'resolution'; id: string };
  text: string;
  authorAuditorId: string;
  enteredByUserId: string;
  state: 'open' | 'answered' | 'resolved';
  createdAt: string;
  posts: { id: string; kind: 'answer' | 'followUp'; byUserId: string; text: string; at: string }[];
}

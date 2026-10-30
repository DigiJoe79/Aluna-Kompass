import type { AuditMode } from '../auditing/types';
import type { PeriodClosePreview } from '../ledger/period';
import type { AccountYearStatementRow } from '../ledger/statement-documents';
import type { ReleaseBasis, ReportFinalizeBlock, ReportRelease, ReportStage } from '../reporting/types';

/**
 * Rechenschaft C (Spec § C, Finanz-Spec § 9.6): der geführte Jahresabschluss in zwölf festen Schritten — kein
 * Aufgabenmanager. Je Schritt ein berechnetes Ergebnis und, wo vorgesehen, eine Bestätigung als Tatsache.
 * Schritt 13 `fundsUse` (Spec 0.4.5 Teil M) steht nur in Jahren mit Einnahmen über der Grenze für die zeitnahe
 * Mittelverwendung (`fundsUseAppliesInternal`); darunter gibt es ihn nicht (Entscheidung 4).
 */
export const CLOSING_STEPS = ['statements', 'cash', 'lists', 'openItems', 'purposes', 'reserves', 'confirmations', 'close', 'auditPackage', 'auditReport', 'assembly', 'taxReturn', 'fundsUse'] as const;
/** Die Nummer eines Schritts ist sein Index + 1. */
export type ClosingStepKey = (typeof CLOSING_STEPS)[number];
/** Schritt 2 bestätigt man je Kasse (`confirmAccountForYear`, `cashRecomputed`), nicht als Ganzes (Board 14a). */
export const CONFIRMABLE_STEPS = ['statements', 'lists', 'openItems', 'purposes', 'reserves', 'confirmations', 'auditReport', 'taxReturn'] as const;
export type ConfirmableStepKey = (typeof CONFIRMABLE_STEPS)[number];
/** 1–7 vor dem Abschluss · 8 der Abschluss · 9–13 danach. */
export type ClosingGroup = 'before' | 'close' | 'after';

export interface ClosingConfirmation {
  note: string | null;
  at: string;
  byUserId: string;
}

export type DischargeOutcome = 'granted' | 'refused' | 'postponed';

/** `assemblyBeforeAuditReport`: Die MV liegt vor dem abgelegten Prüfbericht — ein Hinweis, keine Sperre (E2, Entscheidung c). */
/** `dischargeRefusedAfterGranted`: eine spätere Versammlung verweigerte eine schon erteilte Entlastung (Gremien, W-2) — die erteilte gilt. */
export type AssemblyWarning = 'assemblyBeforeAuditReport' | 'dischargeRefusedAfterGranted';

/** Ergebnis der Mitgliederversammlung zu einem Jahr (Schritt 11) — `closing/assembly.ts`. */
export interface AssemblyResultView {
  fiscalYearId: string;
  assemblyOn: string;
  minutesDocumentId: string | null;
  /** Nur aus einer Quelle (Gremien, W-15): die Protokolle aller Sitzungen, deren Entscheidung gilt. */
  minutesDocumentIds?: string[];
  accountsApproved: 'yes' | 'no' | 'notVoted' | null;
  dischargeMode: 'individual' | 'collective';
  collectiveOutcome: DischargeOutcome | null;
  discharges: { contactId: string; outcome: DischargeOutcome | null; decidedOn: string | null }[];
  warnings: AssemblyWarning[];
  /** Abgelegt am (der Bericht, nicht ein Nachtrag) — für den Satz zur Warnung. */
  auditReportFiledAt: string | null;
  granted: number;
  total: number;
  complete: boolean;
  version: string;
  updatedAt: string;
  /** `null`, wenn das Ergebnis aus einer Quelle kommt (Gremien): Dort steht, wer festgeschrieben hat. */
  updatedByUserId: string | null;
  /** Gesetzt, wenn ein anderes Modul das Ergebnis führt (G7): Schritt 11 zeigt es dann nur an, Speichern lehnt ab. */
  managed: { module: string; meetingId: string; label: string; href: string } | null;
}

/** Eine Amtsübergabe in der Übersicht — `closing/handover.ts`. */
export interface HandoverSummary {
  id: string;
  handoverOn: string;
  fromName: string;
  toName: string;
  state: 'open' | 'done' | 'cancelled';
}

export type ClosingStepFacts =
  | { key: 'statements'; accounts: AccountYearStatementRow[]; accountsWithoutImport: number; openTransactions: number }
  | {
      key: 'cash';
      accounts: {
        accountId: string;
        name: string;
        count: { countId: string; countedOn: string; countedCents: number; differenceCents: number } | null;
        /** Ohne gültige Zählung: die erste Zählung nach dem Stichtag, dazu der Buchbestand am Stichtag (Rückrechnung, Befund 1). */
        later: { countId: string; countedOn: string; countedCents: number; differenceCents: number; bookCentsAtEnd: number } | null;
        /** Bestätigt „rückgerechnet“ (`cashRecomputed`) — erledigt die Kasse ohne Zählung am Stichtag (Board 14a). */
        confirmation: ClosingConfirmation | null;
      }[];
    }
  | { key: 'lists'; undocumentedUnjustified: number; /** Begründet ohne Beleg — dieselbe Quelle wie die Belegprüfung (`undocumentedEntriesOf`, 295/266). */ undocumentedJustified: number; drafts: number; vouchersWithoutEntry: number; foreignMoneyOpen: number }
  | { key: 'openItems'; receivables: { count: number; cents: number }; payables: { count: number; cents: number } }
  | { key: 'purposes'; closedInYear: number; openWithBalance: number; restCents: number; negative: number }
  | { key: 'reserves'; reserves: { reserveId: string; name: string; openingCents: number; closingCents: number; hasResolution: boolean }[] }
  /** Nummern nur bis drei. */
  | { key: 'confirmations'; uncertified: number; toCorrect: number; toCorrectNumbers: string[] }
  | { key: 'close'; closedAt: string | null; preview: PeriodClosePreview | null }
  /** `package`: das zuletzt erzeugte Prüfpaket, sonst der Prüfstand des abgelegten Berichts — Tag und Kurz-Hash (14d). */
  | { key: 'auditPackage'; auditors: { id: string; name: string; mode: AuditMode; accessOk: boolean }[]; packageRun: 'none' | 'running' | 'done' | 'failed'; skippedBy: ReleaseBasis | null; package: { at: string; shortHash: string } | null }
  | {
      key: 'auditReport';
      release: ReportRelease | null;
      filedAt: string | null;
      followUpOpen: boolean;
      changedEntries: number;
      baselineAt: string | null;
      afterAssembly: boolean;
      followUpReportId: string | null;
      followUpReadyToSign: boolean;
      assemblyReports: { done: number; total: number };
      statementsMissing: { accountId: string; name: string }[];
      carryOver: { at: string; note: string; targetDesignation: string } | null;
    }
  /** `pending`: einzeln nicht erteilte Entlastungen mit Namen (gesamt leer, dann sagt es `collectiveOutcome`). */
  /** `formerlyManaged`: Gremien führte das Ergebnis, ist aber ausgeschaltet — es gilt wieder von Hand (V-8). */
  | { key: 'assembly'; result: AssemblyResultView | null; pending: { name: string; outcome: DischargeOutcome | null }[]; formerlyManaged: { label: string } | null }
  /**
   * Rechenschaft D2: der Erklärungszeitraum mit dem Jahr, oder `null`. `lastYear`: das Jahr ist das letzte des
   * Zeitraums — nur dann wartet Schritt 12 auf die Abgabe.
   */
  | {
      key: 'taxReturn';
      /** `last`: Bezeichnung des letzten Jahres; `overdue`: offen und Frist vorbei; `notice`: der tragende Bescheid (15h). */
      period: { id: string; label: string; dueOn: string; filedOn: string | null; lastYear: boolean; last: string; overdue: boolean; notice: { noticeOn: string; documentId: string | null } | null } | null;
      /** E6a: die USt-Jahreserklärung des Kalenderjahres, dessen 31.12. im Geschäftsjahr liegt, wenn sie Pflicht ist — nur genannt. */
      vat: { calendarYear: number; dueOn: string; filedOn: string | null; reason: 'regular' | 'section18_4a'; overdue: boolean } | null;
    }
  /**
   * Schritt 13 (M2): Einnahmen wie Anlage Gem Zeile 9 und die Grenze (`null` = keine Freigrenze); erledigt, wenn die
   * Mittelverwendungsrechnung des Jahres festgeschrieben ist (Stufe `final`).
   */
  | { key: 'fundsUse'; revenueCents: number; limitCents: number | null; stage: ReportStage; finalVersion: { documentNumber: string; finalizedAt: string } | null; /** Stand des Berichts für „Festschreiben …“ im Schritt (U2). */ shortHash: string; /** Warum Festschreiben gerade nicht geht (wie `finance_report`), sonst `null`. */ finalizeBlock: ReportFinalizeBlock | null };

export interface ClosingStepView<F = ClosingStepFacts> {
  key: ClosingStepKey;
  number: number;
  group: ClosingGroup;
  done: boolean;
  confirmable: boolean;
  confirmation: ClosingConfirmation | null;
  facts: F;
}

export interface ClosingStatus {
  fiscalYearId: string;
  designation: string;
  startsOn: string;
  endsOn: string;
  ended: boolean;
  yearStatus: 'open' | 'closed';
  doneCount: number;
  next: ClosingStepKey | null;
  reopened: { at: string; byUserId: string; reason: string } | null;
  toRepeat: ClosingStepKey[];
  handovers: HandoverSummary[];
  steps: ClosingStepView[];
  /** `canCount`: Kasse zählen (`finance.entriesFinalize`); `canRunConfirmations`: Serienlauf (`finance.donationsIssue`). */
  me: { canConfirm: boolean; canClose: boolean; canHandover: boolean; canCount: boolean; canRunConfirmations: boolean };
}

export const groupOf = (key: ClosingStepKey): ClosingGroup => {
  const n = CLOSING_STEPS.indexOf(key) + 1;
  return n <= 7 ? 'before' : n === 8 ? 'close' : 'after';
};

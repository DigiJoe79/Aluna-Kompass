import type { DbOrTx, Failure } from '@kompass/core';
import type { z } from 'zod';

/**
 * Berichtsmechanik (Spec Rechenschaft 0.4.0 § A, Finanz-Spec § 9.1): Ein Bericht ist ein Eintrag im Katalog
 * (`catalog.ts`) mit reiner Rechnung (`compute`) und reinem Körper (`toTypst`). Stufe, Hash, Vorschau und
 * Festschreiben macht der Verteiler (`service.ts`) für alle gleich.
 */

/** Katalogschlüssel, z. B. `incomeStatement`. */
export type ReportKey = string;
/** Gruppe der Seite „Berichte“: Mitgliederversammlung, Kassenprüfung, Finanzamt und Gemeinnützigkeit, Arbeit. */
export type ReportGroup = 'assembly' | 'audit' | 'taxOffice' | 'work';
/** Aus dem Zustand abgeleitet, nie gewählt: Jahr offen → `preliminary`, abgeschlossen → `review`, festgeschrieben → `final`. */
export type ReportStage = 'preliminary' | 'review' | 'final';
export type ReportParams = {
  fiscalYearId?: string;
  fiscalYearIds?: string[];
  date?: string;
  accountId?: string;
  projectId?: string;
  /** EÜR: „Zweckbetrieb und wGB zusammengefasst“ darstellen (§ 64 Abs. 3 S. 2 AO) — nur Darstellung. */
  combineOperations?: boolean;
  /** Rechenschaft D2: der Erklärungszeitraum der Steuererklärung (`taxReturnGem`, `taxReturnIncomeStatement`). */
  taxPeriodId?: string;
  /** E6b: der Voranmeldungszeitraum der Umsatzsteuer-Voranmeldung (`'YYYY-Qn'` oder `'YYYY-MM'`). */
  vatPeriod?: string;
};
/** Worauf die Freigabe zum Festschreiben beruht (Spec § A „Festschreiben erst nach der Kassenprüfung“). */
export type ReleaseBasis = 'auditReport' | 'noAuditProvided' | 'oralReport' | 'singleAuditor' | 'notAudited' | 'other';
export const RELEASE_BASES = ['auditReport', 'noAuditProvided', 'oralReport', 'singleAuditor', 'notAudited', 'other'] as const satisfies readonly ReleaseBasis[];

/** Die Filter von `finance_lines_list`, mit denen ein Agent die Zeilen zu einer Summe holt (Spec § 9.1: keine ID-Listen). */
export interface ReportLinesFilter {
  fiscalYearId?: string;
  sphere?: string;
  direction?: 'income' | 'expense';
  categoryId?: string;
  projectId?: string;
  purposeId?: string;
  accountId?: string;
  from?: string;
  to?: string;
  includeReviewedDrafts?: boolean;
  /** Rechenschaft D2: nur Zeilen mit „Zuführung zum Vermögen“ (Anlage Gem Zeile 63) bzw. erhaltener Vermögensausstattung (Zeile 70). */
  addsToAssets?: boolean;
  assetEndowment?: boolean;
}

/**
 * Was `compute` außer Datenbank und Parametern lesen darf: die Einstellungen aus `settingKeys` (Task B1). Sie bestimmen
 * die Daten mit, gehen also über die Daten in den Hash; die Rechnung bleibt rein.
 */
export interface ReportComputeEnv {
  settings: Readonly<Record<string, unknown>>;
}

/** Namen, die der Körper braucht, aber nicht in die gehashten Daten gehören (sie ändern den Datenstand nicht). */
export interface ReportRenderContext {
  categoryNames: Record<string, string>;
  accountNames: Record<string, string>;
  /**
   * Namen aus dem Bestand, die nicht in die gehashten Daten gehören: `purpose.<id>`, `reserve.<id>`, `project.<id>`
   * (Leitsprache), `user.<id>` (Anzeigename), `otherAsset.<id>`, und Einstellungen des Papiers als `setting.<name>`.
   */
  labels: Record<string, string>;
}

export interface ReportDefinition<D = unknown> {
  key: ReportKey;
  group: ReportGroup;
  /** Mit Personenbezug: lesen nur mit `finance.read`, abgelegt als `finance-report-personal`. */
  personal: boolean;
  /** `false`: steht ausgegraut im Katalog (Mittelverwendungsrechnung bis 0.4.5); jeder Aufruf wird abgelehnt. */
  available: boolean;
  /**
   * `false`: eine Arbeitsliste, die nur heruntergeladen wird (Monatsübersicht, Übergabeliste; Joe 2026-10-25) — sie
   * bleibt `preliminary` und das Festschreiben lehnt ab (`reportNotFinalizable`). Ohne Angabe festschreibbar.
   */
  finalizable?: boolean;
  /**
   * Optional: `calendar`, wenn der Bericht je Kalenderjahr gilt (das Jahr, in dem das Geschäftsjahr endet; Spendenbuch,
   * Personenübersicht). Die Oberfläche nennt den Parameter dann „Kalenderjahr“ (Designer Runde 6, 264/265).
   */
  yearKind?: 'calendar';
  /** `portrait` → `a4-plain-slim`, `landscape` → `a4-quer-plain-slim`. */
  orientation: 'portrait' | 'landscape';
  paramsSchema: z.ZodType<ReportParams>;
  /**
   * Optional: Prüfungen der Parameter gegen den Bestand, nach dem Schema (unbekanntes Geschäftsjahr, eine
   * Darstellung, die für das Jahr nicht zulässig ist). Ein Fehler hier ist eine Ablehnung, kein Absturz in `compute`.
   */
  checkParams?(db: DbOrTx, params: ReportParams): Failure | null;
  /** Die betroffenen Geschäftsjahre (IDs) — die Stufe folgt ihnen. */
  years(db: DbOrTx, params: ReportParams): string[];
  /**
   * Optional (E6b): der letzte Tag des eigenen Zeitraums (Voranmeldung). Mit Wert ist der Bericht bis einschließlich
   * diesem Tag `preliminary`, danach `review`/`final` unabhängig vom Geschäftsjahr; Festschreiben prüft dann weder „Jahr
   * offen“ noch die Kontoauszüge, sondern nur das Ende des Zeitraums (`reportPeriodOpen`). Ein Wiederöffnen des Jahres
   * storniert solche Fassungen nicht.
   */
  periodEnd?(params: ReportParams): { key: string; endsOn: string } | null;
  /**
   * Optional: die Parameter des Berichts für ein Geschäftsjahr auf der Seite „Berichte“, wenn sie nicht `{ fiscalYearId }`
   * sind (Rechenschaft D2: der Erklärungszeitraum mit dem Jahr) — `null`: der Bericht hat zu diesem Jahr keinen Stand.
   */
  paramsForYear?(db: DbOrTx, fiscalYearId: string): ReportParams | null;
  /** Optional: Einstellungen, die die Daten bestimmen — `compute` sieht sie in `env.settings`. */
  settingKeys?: readonly string[];
  /** Rein: dieselben Daten, derselbe Hash. */
  compute(db: DbOrTx, params: ReportParams, env: ReportComputeEnv): D;
  /** Körper in Typst, rein. */
  toTypst(data: D, ctx: ReportRenderContext): string;
  /** Schlüssel des Titels in `de.json` (`finance.reports.<key>.title`). */
  titleKey: string;
  /**
   * Der Titel auf dem Papier, deutsch in der Modul-Vorlage wie bei den übrigen Vorlagen der Finanzen (Prinzip 7:
   * das Papier ist kein Bildschirmtext; die Oberfläche liest `titleKey`).
   */
  paperTitle: string;
  /**
   * Optional: ein Teil des Untertitels vor dem Zeitraum („Kassenteil des Jahresberichts …“), aus den Beschriftungen
   * (`labels`, auch Einstellungen als `setting.<name>`) — Darstellung, nicht im Hash.
   */
  paperSubtitle?(ctx: ReportRenderContext): string;
  /**
   * Optional: der Zeitraum im Untertitel statt „Geschäftsjahr …“ — etwa „Kalenderjahr 2026“ bei Spendenbuch und
   * Personenübersicht, die je Kalenderjahr gelten. Aus den Daten, rein.
   */
  paperPeriod?(data: D): string;
  /**
   * Optional: warum dieser Datenstand nicht festgeschrieben werden darf, obwohl der Bericht gezeigt wird (Kassenbericht:
   * die Probe geht nicht auf). `code` ist ein Fehlercode des Moduls (`FINANCE_ERRORS`).
   */
  finalizeBlock?(data: D): { code: 'reportProbeFails'; params: { differenceCents: number } } | { code: 'reportGemIncomplete'; params: { missing: number } } | null;
  /** Optional: je Summe des Berichts die Filter für `finance_lines_list`. */
  linesFilter?(data: D, params: ReportParams): Record<string, ReportLinesFilter>;
  /**
   * Optional: hat der Bericht keinen Inhalt, der Satz, den das PDF dann zeigt — sonst `null` (Designer Runde 7, 16a D).
   * Eine Quelle: Der Körper (`toTypst`) setzt denselben Satz. Die Seite zeigt ihn statt eines leeren Blatts.
   */
  empty?(data: D): string | null;
}

export interface ReportRun<D = unknown> {
  report: ReportKey;
  params: ReportParams;
  stage: ReportStage;
  hash: string;
  shortHash: string;
  data: D;
  released: ReleaseBasis | null;
  /**
   * Warum dieser Datenstand jetzt nicht festgeschrieben werden kann, oder `null` (Rechenschaft A3): dieselbe Prüfung
   * wie beim Festschreiben. `code` ist ein Fehlercode des Moduls; die Oberfläche zeigt danach Satz und Knopf.
   */
  finalizeBlock: ReportFinalizeBlock | null;
  /** `false` bei Arbeitslisten, die nie festgeschrieben werden (`ReportDefinition.finalizable`). */
  finalizable: boolean;
  /** Je Summe Anzahl und Filter der Zeilen, sofern die Definition `linesFilter` liefert. */
  lines?: Record<string, { count: number; filter: ReportLinesFilter }>;
  /** Ohne Inhalt der Satz aus dem PDF (`ReportDefinition.empty`), sonst `null` (Designer Runde 7, 16a D). */
  empty: string | null;
  /**
   * Bei `final` die geltende Fassung mit genau diesem Datenstand — ihre Datei in der Akte ist, was Seite, Bilder und
   * Herunterladen zeigen (Designer Runde 7, 16a C); sonst `null`.
   */
  finalVersion: ReportFinalVersion | null;
}

/** Die geltende festgeschriebene Fassung eines Laufs in der Stufe `final`. */
export interface ReportFinalVersion {
  reportId: string;
  finalizedAt: string;
  documentId: string;
  documentNumber: string;
  shortHash: string;
}

export interface ReportFinalizeBlock {
  code: 'reportNotFinalizable' | 'reportYearOpen' | 'reportPeriodOpen' | 'reportNotReleased' | 'reportStatementsMissing' | 'reportProbeFails' | 'reportAlreadyFinal' | 'reportGemIncomplete';
  params: Record<string, string | number>;
}

/** Die geltende Freigabe eines Jahres zum Festschreiben (Designer Runde 2, 11a). */
export interface ReportRelease {
  basis: ReleaseBasis;
  note: string | null;
  /** Der Scan des Prüfberichts bei `auditReport`. */
  documentId: string | null;
  at: string;
  byUserId: string;
}

/** Eine festgeschriebene Fassung eines Berichts, auch zurückgenommen (Rechenschaft A3, Tabelle „Festgeschriebene Fassungen“). */
export interface ReportVersionView {
  reportId: string;
  finalizedAt: string;
  byUserId: string;
  shortHash: string;
  documentId: string;
  documentNumber: string;
  releaseBasis: ReleaseBasis | null;
  voidedAt: string | null;
  voidReason: string | null;
  replacedByReportId: string | null;
}

export interface ReportListItem {
  key: ReportKey;
  group: ReportGroup;
  personal: boolean;
  available: boolean;
  orientation: 'portrait' | 'landscape';
  /** `null`, wenn `available` false. */
  stage: ReportStage | null;
  lastFinal: { finalizedAt: string; byUserId: string; documentId: string; documentNumber: string; voided: boolean }[];
}

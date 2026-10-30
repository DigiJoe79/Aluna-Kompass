import type { DbOrTx, Deps } from '@kompass/core';
import type { FinanceFiscalYearRow } from './schema';

/**
 * Registrierbare Quellen (Spec Gremien § 8.1): Ein Modul, das von den Finanzen abhängt (Gremien), liefert ihnen
 * Ergebnisse, ohne dass die Finanzen es kennen — die Richtung Finanzen → Gremien bleibt verboten. Vorbild ist
 * `registerAssemblyPersonSource` (`closing/assembly.ts`). Jede Quelle prüft selbst, ob ihr Modul eingeschaltet ist, und
 * liefert sonst nichts. Doppelte Registrierung wird übergangen; der Leser nimmt die erste Quelle, die etwas liefert.
 */

/** Das Ergebnis einer festgeschriebenen Mitgliederversammlung zu einem Geschäftsjahr (Schritt 11). */
export interface GovernedAssembly {
  source: { module: string; meetingId: string; label: string; href: string };
  assemblyOn: string;
  minutesDocumentId: string | null;
  /** W-15: die Protokolle aller Sitzungen, deren Entscheidung gilt, nach Sitzungstag. */
  minutesDocumentIds?: string[];
  accountsApproved: 'yes' | 'no' | 'notVoted';
  dischargeMode: 'individual' | 'collective';
  collectiveOutcome: 'granted' | 'refused' | 'postponed' | null;
  discharges: { contactId: string; outcome: 'granted' | 'refused' | 'postponed'; decidedOn: string }[];
  /** Hinweise der Quelle, nie eine Sperre (W-2). */
  warnings?: 'dischargeRefusedAfterGranted'[];
}

/**
 * `evenIfDisabled`: auch wenn das Modul ausgeschaltet ist — nur für den Hinweis, dass ein Ergebnis bisher dort geführt
 * war (V-8); geliefert wird es dann nicht.
 */
export type AssemblyResultSource = (deps: Deps, db: DbOrTx, year: FinanceFiscalYearRow, opts?: { evenIfDisabled?: boolean }) => GovernedAssembly | null;
const assemblySources: AssemblyResultSource[] = [];

export function registerAssemblyResultSource(source: AssemblyResultSource): void {
  if (!assemblySources.includes(source)) assemblySources.push(source);
}

/** Das Ergebnis der ersten Quelle, die für das Jahr etwas liefert — `null`, wenn keine. */
export function governedAssemblyOf(deps: Deps, db: DbOrTx, year: FinanceFiscalYearRow): GovernedAssembly | null {
  for (const source of assemblySources) {
    const found = source(deps, db, year);
    if (found) return found;
  }
  return null;
}

/**
 * V-8: Führt keine Quelle das Ergebnis, hätte es aber eine ausgeschaltete geführt — dann gilt Schritt 11 wieder von
 * Hand, und die Finanzen sagen es dazu. `null`, wenn nie geführt oder noch geführt.
 */
export function formerlyGovernedAssemblyOf(deps: Deps, db: DbOrTx, year: FinanceFiscalYearRow): { label: string } | null {
  if (governedAssemblyOf(deps, db, year)) return null;
  for (const source of assemblySources) {
    const found = source(deps, db, year, { evenIfDisabled: true });
    if (found) return { label: found.source.label };
  }
  return null;
}

/** Eine Kassenprüferin, die ein anderes Modul (Gremien) für den Prüfzeitraum führt — ein Vorschlag, kein Eintrag. */
export interface AuditorCandidate {
  contactId: string;
  name: string;
  electedOn: string | null;
  minutesDocumentId: string | null;
  source: { label: string; href: string };
}

export type AuditorCandidateSource = (deps: Deps, db: DbOrTx, year: FinanceFiscalYearRow) => AuditorCandidate[];
const auditorSources: AuditorCandidateSource[] = [];

export function registerAuditorCandidateSource(source: AuditorCandidateSource): void {
  if (!auditorSources.includes(source)) auditorSources.push(source);
}

/** Die Vorschläge der ersten Quelle, die für das Jahr welche liefert — leer, wenn keine. */
export function auditorCandidatesOf(deps: Deps, db: DbOrTx, year: FinanceFiscalYearRow): AuditorCandidate[] {
  for (const source of auditorSources) {
    const found = source(deps, db, year);
    if (found.length > 0) return found;
  }
  return [];
}

/** Das Satzungsdatum für die Anlage Gem (Zeile „Satzung in der Fassung vom“) aus einem anderen Modul (Gremien). */
export interface StatuteSuggestion {
  statuteDate: string;
  documentId: string | null;
  source: { label: string; href: string };
}

export type StatuteSource = (deps: Deps, db: DbOrTx, on: string) => StatuteSuggestion | null;
const statuteSources: StatuteSource[] = [];

export function registerStatuteSource(source: StatuteSource): void {
  if (!statuteSources.includes(source)) statuteSources.push(source);
}

/** Der Vorschlag der ersten Quelle für den Stichtag `on` — `null`, wenn keine etwas liefert. */
export function statuteSuggestionOf(deps: Deps, db: DbOrTx, on: string): StatuteSuggestion | null {
  for (const source of statuteSources) {
    const found = source(deps, db, on);
    if (found) return found;
  }
  return null;
}

/**
 * Eckdaten eines Beschlusses aus einem anderen Modul (Gremien), damit Rücklage und Beitragsordnung nur einen
 * passenden Beschluss annehmen (V-3): Art, ob festgeschrieben, Ergebnis und Beschlusstag.
 */
export interface ResolutionFacts {
  kind: string;
  final: boolean;
  outcome: string | null;
  decidedOn: string;
}

export type ResolutionFactsSource = (deps: Deps, db: DbOrTx, resolutionId: string) => ResolutionFacts | null;
const resolutionFactsSources: ResolutionFactsSource[] = [];

export function registerResolutionFactsSource(source: ResolutionFactsSource): void {
  if (!resolutionFactsSources.includes(source)) resolutionFactsSources.push(source);
}

/** Die Eckdaten der ersten Quelle, die den Beschluss kennt — `null`, wenn keine. */
export function resolutionFactsOf(deps: Deps, db: DbOrTx, resolutionId: string): ResolutionFacts | null {
  for (const source of resolutionFactsSources) {
    const found = source(deps, db, resolutionId);
    if (found) return found;
  }
  return null;
}

/** Die finanzwirksamen Beschlussarten, die die Kassenprüfung zeigt (G-30). */
export const AUDIT_RESOLUTION_KINDS = ['discharge', 'accounts', 'remuneration', 'expenseRule', 'reserve', 'feeSchedule'] as const;
export type AuditResolutionKind = (typeof AUDIT_RESOLUTION_KINDS)[number];

/**
 * Ein festgeschriebener, finanzwirksamer Beschluss für Abschnitt 9 der Kassenprüfung (G-30, Designer 2026-10-29):
 * Werte und Codes, **kein Freitext** (kein Antragstext, keine Regel, kein Zweck). Fehlt eine Angabe, fehlt das Feld.
 */
export interface AuditResolution {
  id: string;
  number: string;
  decidedOn: string;
  kind: AuditResolutionKind;
  outcome: 'adopted' | 'rejected';
  /** Name des Organs; `viaCircular`: im Umlauf gefasst. */
  organ: string;
  viaCircular: boolean;
  /** Das Protokoll der Sitzung; ein Umlauf hat keins. */
  minutesDocumentId: string | null;
  facts: {
    /** Geschäftsjahr (Entlastung, Kassenbericht, Rücklage) als Bezeichnung. */
    fiscalYear?: string;
    amountCents?: number;
    validFrom?: string;
    /** Entlastung: die Personen mit ihrem Amt („Peter Hahn (1. Vorsitz)“); `collective`: der Vorstand gesamt. */
    persons?: string;
    collective?: boolean;
    /** Vergütung: die Organe der vergüteten Ämter; `remunerationMode` pauschal oder je Tätigkeit. */
    organs?: string;
    remunerationMode?: 'flat' | 'activity';
    expenseBasis?: 'statute' | 'contract' | 'boardResolution';
    reserveType?: 'nr1' | 'nr2' | 'nr3' | 'nr4';
    reserveAction?: 'create' | 'withdraw' | 'dissolve';
  };
}

/** `null`: Das Modul der Quelle ist ausgeschaltet — dann gibt es den Abschnitt nicht. */
export type AuditResolutionSource = (deps: Deps, db: DbOrTx, year: FinanceFiscalYearRow) => AuditResolution[] | null;
const auditResolutionSources: AuditResolutionSource[] = [];

export function registerAuditResolutionSource(source: AuditResolutionSource): void {
  if (!auditResolutionSources.includes(source)) auditResolutionSources.push(source);
}

/**
 * Die Beschlüsse aller eingeschalteten Quellen für das Prüfjahr — `null`, wenn keine Quelle registriert oder
 * eingeschaltet ist (dann hat die Kassenprüfung acht Abschnitte).
 */
export function auditResolutionsOf(deps: Deps, db: DbOrTx, year: FinanceFiscalYearRow): AuditResolution[] | null {
  let out: AuditResolution[] | null = null;
  for (const source of auditResolutionSources) {
    const found = source(deps, db, year);
    if (found) out = [...(out ?? []), ...found];
  }
  return out;
}

import type { AuditStatus } from '@kompass/module-finance';
import { AUDIT_SECTION_ORDER } from './audit-sections';

/**
 * Die Übersicht der Kassenprüfung als Logik (Plan D1b Task 3): welches Jahr sie zeigt und welcher Stand im Kopf steht.
 * Die Sätze baut die Seite aus `finance.audit.head.*`.
 */

export interface AuditYearOption {
  id: string;
  endsOn: string;
  status: string;
}

/**
 * Vorgabe des Jahres: Wer prüft, sieht die laufende Prüfung, wenn er dort eingetragen ist, sonst sein jüngstes Jahr;
 * alle anderen die laufende Prüfung, sonst das jüngste abgeschlossene Jahr, sonst das jüngste.
 */
export function defaultAuditYearId(years: readonly AuditYearOption[], currentId: string | null, myYearIds: readonly string[]): string | null {
  if (myYearIds.length > 0) return currentId && myYearIds.includes(currentId) ? currentId : myYearIds[0]!;
  if (currentId && years.some((y) => y.id === currentId)) return currentId;
  const newestFirst = [...years].sort((a, b) => b.endsOn.localeCompare(a.endsOn));
  return (newestFirst.find((y) => y.status === 'closed') ?? newestFirst[0])?.id ?? null;
}

export type AuditReportStand = 'missing' | 'draft' | 'readyToSign' | 'partial';

export type AuditHead =
  | { kind: 'yearOpen' }
  | { kind: 'noAuditors' }
  | { kind: 'done'; filedAt: string | null; confirmedAt?: string | null }
  | { kind: 'followUp'; since: string | null; changed: number; filedAt: string | null }
  | { kind: 'running'; since: string | null; reviewed: number; total: number; remarksOpen: number; report: AuditReportStand; scans: { filed: number; expected: number } };

/**
 * Der Stand im Kopf (Board 4a, 12c; Spec § D1 „Wiederöffnen“). `referenceAt` ist der Tag der Prüffassung, gegen die
 * „geändert“ zählt (beim Nachtrag die des abgelegten Berichts); `filedAt` der Tag, an dem der Bericht abgelegt wurde.
 */
export function auditHead(status: AuditStatus, auditorCount: number, opts: { referenceAt: string | null; filedAt: string | null }): AuditHead {
  if (status.yearStatus !== 'closed') return { kind: 'yearOpen' };
  if (auditorCount === 0) return { kind: 'noAuditors' };
  if (status.followUpOpen) return { kind: 'followUp', since: opts.referenceAt, changed: status.changedEntryIds.length, filedAt: opts.filedAt };
  const report = status.report;
  if (report?.state === 'filed') return { kind: 'done', filedAt: opts.filedAt, confirmedAt: status.followUpConfirmedAt ?? null };
  const stand: AuditReportStand = !report ? 'missing' : report.state === 'draft' ? 'draft' : report.scansFiled > 0 ? 'partial' : 'readyToSign';
  return {
    kind: 'running',
    since: status.baseline?.createdAt ?? null,
    reviewed: status.sectionsReviewed.length,
    total: AUDIT_SECTION_ORDER.length,
    remarksOpen: status.remarksUnresolved,
    report: stand,
    scans: { filed: report?.scansFiled ?? 0, expected: report?.scansExpected ?? 1 },
  };
}

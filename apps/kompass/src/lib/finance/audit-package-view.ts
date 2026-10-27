import type { JobStep } from '@kompass/core';
import type { AuditPackageFile, AuditPackageRunStatus } from '@kompass/module-finance';
import { viewError, type ViewError } from '@/lib/site-job-view';

/** Was die Status-Route des Prüfpakets an den Browser gibt (Board 4e, `RunSteps`). Kein Ergebnis mit Pfaden. */
export interface AuditPackageView {
  state: 'idle' | 'running' | 'success' | 'failed' | 'aborted' | 'interrupted' | 'outdated';
  runId: string | null;
  cancellable: boolean;
  steps: JobStep[];
  finishedAt: string | null;
  files: AuditPackageFile[];
  /** Übersprungene Schritte mit dem Code des Grundes (`noExport` …). */
  skipped: Partial<Record<AuditPackageFile, string>>;
  error?: ViewError;
  /** Darf der Aufrufer erzeugen und abbrechen (`finance.periodClose`, Befund 11 a)? Prüfer sehen nur die Dateien. */
  canStart: boolean;
}

type Translate = Parameters<typeof viewError>[1];

export function auditPackageView(status: AuditPackageRunStatus, t: Translate, canStart: boolean): AuditPackageView {
  if (status.running) return { state: 'running', runId: status.running.runId, cancellable: status.running.cancellable, steps: status.running.steps, finishedAt: null, files: [], skipped: {}, canStart };
  const last = status.last;
  if (!last) return { state: 'idle', runId: null, cancellable: false, steps: [], finishedAt: null, files: [], skipped: {}, canStart };
  return {
    state: status.outdated ? 'outdated' : last.status,
    runId: last.runId,
    cancellable: false,
    steps: last.steps,
    finishedAt: last.finishedAt,
    files: status.files,
    skipped: last.result?.skipped ?? {},
    ...(last.error ? { error: viewError(last.error, t) } : {}),
    canStart,
  };
}

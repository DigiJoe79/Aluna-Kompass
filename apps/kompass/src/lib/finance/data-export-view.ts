import type { JobStep } from '@kompass/core';
import type { DataExportRunStatus } from '@kompass/module-finance';
import { viewError, type ViewError } from '@/lib/site-job-view';

/** Was die Status-Route des Datenexports an den Browser gibt (Board 13f, `RunSteps`). Keine Pfade, keine Dateinamen. */
export interface DataExportRunView {
  state: 'idle' | 'running' | 'success' | 'failed' | 'aborted' | 'interrupted';
  runId: string | null;
  cancellable: boolean;
  steps: JobStep[];
  /** „2024, 2025“ — die Jahre des laufenden oder letzten Laufs. */
  designations: string | null;
  finishedAt: string | null;
  error?: ViewError;
}

type Translate = Parameters<typeof viewError>[1];

export const IDLE_DATA_EXPORT: DataExportRunView = { state: 'idle', runId: null, cancellable: false, steps: [], designations: null, finishedAt: null };

export function dataExportRunView(status: DataExportRunStatus | null, t: Translate): DataExportRunView {
  if (!status) return IDLE_DATA_EXPORT;
  const designations = (meta: Record<string, unknown>) => (typeof meta.designations === 'string' ? meta.designations : null);
  if (status.running) return { state: 'running', runId: status.running.runId, cancellable: status.running.cancellable, steps: status.running.steps, designations: designations(status.running.meta), finishedAt: null };
  const last = status.last;
  if (!last) return IDLE_DATA_EXPORT;
  return {
    state: last.status,
    runId: last.runId,
    cancellable: false,
    steps: last.steps,
    designations: designations(last.meta),
    finishedAt: last.finishedAt,
    ...(last.error ? { error: viewError(last.error, t) } : {}),
  };
}

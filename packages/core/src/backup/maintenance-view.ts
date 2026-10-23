import { DEFAULT_TIME_ZONE } from '../dates';
import { readJobResult, runningJob, type JobMeta, type JobStep } from '../jobs';
import { backupJobSlot } from './jobs';
import { readMaintenance } from './maintenance';

/*
 * Zustand der Wartungsseite — ohne Sitzung und ohne Datenbank, nur aus Merker und Lauf-Dateien. Nicht im Proxy
 * verwenden. Was die Seite sonst aus der Datenbank läse (Name der Person, Verein, Zeitzone, Dauer), legt
 * `launchRestore` beim Start in `meta` des Laufs ab (Plan U1).
 */

export interface MaintenanceRunInfo {
  runId: string;
  backupCreatedAt: string;
  startedAt: string;
  startedBy: string | null;
  estimatedSeconds: number | null;
  /** Vereinszeitzone beim Start; Vorgabe `DEFAULT_TIME_ZONE`, wenn `meta` sie nicht kennt. */
  timeZone: string;
  organization: string | null;
  steps: JobStep[];
}

export type MaintenanceView =
  | { phase: 'idle' }
  | ({ phase: 'running' | 'done' } & MaintenanceRunInfo)
  | ({ phase: 'failed'; failedStep: string | null } & MaintenanceRunInfo)
  | ({ phase: 'rollbackFailed'; failedStep: string | null; aside: string; contact: string | null } & MaintenanceRunInfo);

/** So lange zeigt die Wartungsseite nach dem Ende eines Einspielens „eingespielt“ bzw. „gescheitert“. */
const SHOW_RESULT_MS = 60 * 60 * 1000;

const text = (meta: JobMeta, key: string): string | null => (typeof meta[key] === 'string' && meta[key] !== '' ? (meta[key] as string) : null);

function infoOf(runId: string, startedAt: string, meta: JobMeta, steps: JobStep[], backupCreatedAt?: string): MaintenanceRunInfo {
  const seconds = meta.estimatedSeconds;
  return {
    runId,
    backupCreatedAt: backupCreatedAt ?? text(meta, 'backupCreatedAt') ?? '',
    startedAt,
    startedBy: text(meta, 'startedBy'),
    estimatedSeconds: typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : null,
    timeZone: text(meta, 'timeZone') ?? DEFAULT_TIME_ZONE,
    organization: text(meta, 'organization'),
    steps,
  };
}

export function maintenanceView(backupPath: string, now: Date): MaintenanceView {
  const slot = backupJobSlot(backupPath);
  const marker = readMaintenance(backupPath);
  const running = runningJob(slot);
  if (marker?.phase === 'rollbackFailed') {
    const record = readJobResult(slot, 'restore');
    const same = record?.runId === marker.runId ? record : null;
    const live = running?.runId === marker.runId ? running : null;
    const source = same ?? live;
    return {
      phase: 'rollbackFailed',
      ...infoOf(marker.runId, source?.startedAt ?? marker.since, source?.meta ?? {}, source?.steps ?? [], marker.backupCreatedAt),
      failedStep: same?.lastStep ?? live?.steps.find((s) => s.state === 'running')?.key ?? null,
      aside: marker.aside ?? '',
      contact: marker.contact,
    };
  }
  if (marker) {
    if (running?.runId === marker.runId) return { phase: 'running', ...infoOf(marker.runId, running.startedAt, running.meta, running.steps, marker.backupCreatedAt) };
    const record = readJobResult(slot, 'restore');
    const same = record?.runId === marker.runId ? record : null;
    return { phase: 'running', ...infoOf(marker.runId, same?.startedAt ?? marker.since, same?.meta ?? {}, same?.steps ?? [], marker.backupCreatedAt) };
  }
  // Vor dem Merker (Sichern, Prüfen) landet die einspielende Person schon hier — kein Umleiten auf `/`.
  if (running?.kind === 'restore') return { phase: 'running', ...infoOf(running.runId, running.startedAt, running.meta, running.steps) };
  const last = readJobResult(slot, 'restore');
  if (!last || now.getTime() - new Date(last.finishedAt).getTime() > SHOW_RESULT_MS) return { phase: 'idle' };
  const info = infoOf(last.runId, last.startedAt, last.meta, last.steps);
  return last.status === 'success' ? { phase: 'done', ...info } : { phase: 'failed', ...info, failedStep: last.lastStep ?? null };
}

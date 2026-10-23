import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupJobSlot } from '../src/backup/jobs';
import { clearMaintenance, isMaintenanceActive, maintenanceFile, readMaintenance, writeMaintenance, type MaintenanceMarker } from '../src/backup/maintenance';
import { maintenanceView } from '../src/backup/maintenance-view';
import { fixedClock } from '../src/clock';
import { DEFAULT_TIME_ZONE } from '../src/dates';
import { BACKUP_JOB_STEPS } from '../src/backup/jobs';
import { writeJsonAtomic, type JobRecord } from '../src/jobs';
import { jobResultFile } from '../src/jobs/run-state';
import { mkdirSync } from 'node:fs';
import { beginJob, endJob, launchJob } from '../src/jobs';
import { localizedConflict, ok } from '../src/result';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-maintenance-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const CREATED = '2026-10-22T01:00:00.000Z';
const marker = (patch: Partial<MaintenanceMarker> = {}): MaintenanceMarker => ({
  runId: 'restore-20261023-1000',
  since: '2026-10-23T10:00:00.000Z',
  phase: 'prepare',
  aside: null,
  backupName: 'b',
  backupCreatedAt: CREATED,
  contact: 'info@example.org',
  ...patch,
});
const restoreInit = (runId: string) => ({ kind: 'restore', steps: ['safeguard', 'verify', 'replace', 'migrate', 'finish'], source: 'ui' as const, userId: 'U', runId, meta: { name: 'b', backupCreatedAt: CREATED } });
const META = { name: 'b', backupCreatedAt: CREATED, startedBy: 'Erika Beispiel', estimatedSeconds: 300, timeZone: 'Europe/Berlin', organization: 'Musterverein e.V.' };
/** Ein Ergebnis `restore` von Hand, wie es launchJob schriebe. */
const writeRestoreResult = (bp: string, patch: Partial<JobRecord>) => {
  const slot = backupJobSlot(bp);
  mkdirSync(slot.dir, { recursive: true });
  const record: JobRecord = {
    kind: 'restore',
    runId: 'restore-20261023-1031',
    startedAt: '2026-10-23T08:31:00.000Z',
    finishedAt: '2026-10-23T10:25:00.000Z',
    userId: 'U',
    status: 'failed',
    steps: BACKUP_JOB_STEPS.restore.map((key) => ({ key, state: 'pending' as const })),
    meta: META,
    ...patch,
  };
  writeJsonAtomic(jobResultFile(slot, 'restore'), record);
};

describe('Wartungsmerker', () => {
  it('schreibt, liest und löscht den Merker atomar', () => {
    const bp = tmp();
    expect(isMaintenanceActive(bp)).toBe(false);
    expect(readMaintenance(bp)).toBeNull();
    const m = marker();
    writeMaintenance(bp, m);
    expect(maintenanceFile(bp)).toBe(path.join(bp, '.jobs', 'maintenance.json'));
    expect(readMaintenance(bp)).toEqual(m);
    expect(isMaintenanceActive(bp)).toBe(true);
    clearMaintenance(bp);
    expect(isMaintenanceActive(bp)).toBe(false);
    clearMaintenance(bp); // ohne Merker kein Wurf
  });
});

describe('maintenanceView', () => {
  const now = new Date('2026-10-23T10:30:00.000Z');

  it('ohne Merker und ohne Lauf: idle', () => {
    expect(maintenanceView(tmp(), now)).toEqual({ phase: 'idle' });
  });

  it('running aus Merker und laufendem Lauf, mit Schritten und runId', () => {
    const bp = tmp();
    const slot = backupJobSlot(bp);
    const h = beginJob(slot, fixedClock('2026-10-23T10:00:00.000Z'), restoreInit('restore-20261023-1000'));
    if ('busy' in h) throw new Error('busy');
    h.begin('safeguard');
    writeMaintenance(bp, marker());
    const view = maintenanceView(bp, now);
    expect(view).toMatchObject({ phase: 'running', runId: 'restore-20261023-1000', backupCreatedAt: CREATED });
    expect(view.phase === 'running' && view.steps.map((s) => [s.key, s.state])[0]).toEqual(['safeguard', 'running']);
    endJob(slot, h.run.runId);
  });

  it('rollbackFailed mit Rücklage und Kontakt, ohne Ergebnis desselben Laufs ohne Schritte', () => {
    const bp = tmp();
    writeMaintenance(bp, marker({ phase: 'rollbackFailed', aside: '/data/.before-import-X' }));
    expect(maintenanceView(bp, now)).toMatchObject({
      phase: 'rollbackFailed',
      runId: 'restore-20261023-1000',
      backupCreatedAt: CREATED,
      startedAt: '2026-10-23T10:00:00.000Z',
      aside: '/data/.before-import-X',
      contact: 'info@example.org',
      steps: [],
      failedStep: null,
    });
  });

  it('rollbackFailed liefert Schritte und gescheiterten Schritt aus dem Ergebnis desselben Laufs', () => {
    const bp = tmp();
    writeRestoreResult(bp, { lastStep: 'migrate' });
    writeMaintenance(bp, marker({ runId: 'restore-20261023-1031', phase: 'rollbackFailed', aside: '/data/.before-import-X' }));
    const view = maintenanceView(bp, now);
    expect(view).toMatchObject({ phase: 'rollbackFailed', failedStep: 'migrate', startedAt: '2026-10-23T08:31:00.000Z', startedBy: 'Erika Beispiel', contact: 'info@example.org' });
    expect(view.phase === 'rollbackFailed' && view.steps).toHaveLength(5);
  });

  it('zeigt einen laufenden restore schon vor dem Merker als running, mit Name, Dauer und Zone aus meta', () => {
    const bp = tmp();
    const slot = backupJobSlot(bp);
    const h = beginJob(slot, fixedClock('2026-10-23T08:31:00.000Z'), { ...restoreInit('restore-20261023-1031'), meta: META });
    if ('busy' in h) throw new Error('busy');
    h.begin('safeguard');
    expect(maintenanceView(bp, now)).toMatchObject({
      phase: 'running',
      runId: 'restore-20261023-1031',
      startedAt: '2026-10-23T08:31:00.000Z',
      startedBy: 'Erika Beispiel',
      estimatedSeconds: 300,
      timeZone: 'Europe/Berlin',
      organization: 'Musterverein e.V.',
      backupCreatedAt: CREATED,
    });
    endJob(slot, h.run.runId);
  });

  it('ein laufender create oder verify ohne Merker bleibt idle', () => {
    const bp = tmp();
    const slot = backupJobSlot(bp);
    const h = beginJob(slot, fixedClock('2026-10-23T08:31:00.000Z'), { kind: 'create', steps: ['database'], source: 'ui', userId: 'U', runId: 'C1' });
    if ('busy' in h) throw new Error('busy');
    expect(maintenanceView(bp, now)).toEqual({ phase: 'idle' });
    endJob(slot, h.run.runId);
  });

  it('failed nennt den gescheiterten Schritt aus lastStep', () => {
    const bp = tmp();
    writeRestoreResult(bp, { lastStep: 'replace' });
    expect(maintenanceView(bp, now)).toMatchObject({ phase: 'failed', failedStep: 'replace', startedBy: 'Erika Beispiel', timeZone: 'Europe/Berlin', startedAt: '2026-10-23T08:31:00.000Z' });
  });

  it('ohne meta (Lauf von vor diesem Plan): timeZone DEFAULT_TIME_ZONE, startedBy null, estimatedSeconds null', () => {
    const bp = tmp();
    writeRestoreResult(bp, { status: 'success', meta: { name: 'b', backupCreatedAt: CREATED } });
    expect(maintenanceView(bp, now)).toMatchObject({ phase: 'done', timeZone: DEFAULT_TIME_ZONE, startedBy: null, estimatedSeconds: null, organization: null });
  });

  it('done bzw. failed aus dem letzten Ergebnis restore, nur bis 60 min nach dem Ende', async () => {
    const bp = tmp();
    const slot = backupJobSlot(bp);
    const clock = fixedClock('2026-10-23T10:00:00.000Z');
    const a = launchJob(slot, clock, restoreInit('R1'), async () => ok({}));
    if ('busy' in a) throw new Error('busy');
    await a.done;
    expect(maintenanceView(bp, now)).toMatchObject({ phase: 'done', runId: 'R1', backupCreatedAt: CREATED });
    expect(maintenanceView(bp, new Date('2026-10-23T11:01:00.000Z'))).toEqual({ phase: 'idle' });
    const b = launchJob(slot, clock, restoreInit('R2'), async () => localizedConflict('restoreFailed', 'backup.errors.restoreFailed'));
    if ('busy' in b) throw new Error('busy');
    await b.done;
    expect(maintenanceView(bp, now)).toMatchObject({ phase: 'failed', runId: 'R2', backupCreatedAt: CREATED });
  });
});

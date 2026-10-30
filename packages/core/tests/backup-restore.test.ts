import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeps, type AppDeps } from '../src/app';
import { recordAudit } from '../src/audit/log';
import { createApiToken, revokeApiToken } from '../src/auth/tokens';
import { launchBackupCreate } from '../src/backup/create';
import { BACKUP_JOB_STEPS, backupJobSlot } from '../src/backup/jobs';
import { isMaintenanceActive, readMaintenance, writeMaintenance } from '../src/backup/maintenance';
import { listBackups } from '../src/backup/sidecar';
import { fixedClock } from '../src/clock';
import type { CallContext } from '../src/context';
import { apiTokens, auditLog, sessions, users } from '../src/db/schema';
import { launchJob, requestJobCancel, waitForJob, type JobRecord, type JobStart } from '../src/jobs';
import type { ModuleManifest } from '../src/modules/manifest';
import { ok, unwrap, type Result } from '../src/result';
import { seedDevelopment } from '../src/seed/seed';
import { isSetupRequired } from '../src/setup/service';
import { coreModule } from '../src/core-module';
import { registerRestoreHooks, restoreHooks, type RestoreHooks } from '../src/backup/hooks';
import { BACKUP_HUMAN_ONLY_SETTING, confirmationNameFor, estimateRestoreSeconds, INSTALLATION_SETTING_KEYS, recoverInterruptedRestore, restorePreview, startRestore, startSetupRestore } from '../src/backup/restore';
import { timeZoneOf } from '../src/today';
import { lastPublishedAt } from '../src/modules/published';
import { defineModule } from '../src/modules/manifest';
import { readSetting, setSetting, writeSettingInternal } from '../src/settings/service';
import { auditEntry, createTestDeps, ctxWith, insertUser, systemContext } from '../src/testing';

describe('Einspielen: Grundlagen', () => {
  it('nennt den Bestätigungsnamen je Umgebung', () => {
    expect(confirmationNameFor('production')).toBe('produktion');
    expect(confirmationNameFor('test')).toBe('test');
    expect(confirmationNameFor('development')).toBe('entwicklung');
  });

  it('führt den Agenten-Schalter als Kern-Einstellung, Vorgabe aus, nur über die Oberfläche', async () => {
    const deps = createTestDeps();
    expect(BACKUP_HUMAN_ONLY_SETTING).toBe('backup.mcpHumanOnlyAllowed');
    expect(readSetting(deps, BACKUP_HUMAN_ONLY_SETTING)).toBe(false);
    const mcp = { ...ctxWith(['settings.manage']), channel: 'mcp' as const };
    expect(await setSetting(deps, mcp, { key: BACKUP_HUMAN_ONLY_SETTING, value: true })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'settingUiOnly' } });
    expect((await setSetting(deps, ctxWith(['settings.manage']), { key: BACKUP_HUMAN_ONLY_SETTING, value: true })).ok).toBe(true);
    for (const key of INSTALLATION_SETTING_KEYS) expect(deps.registry.settingDefinitions.has(key), key).toBe(true);
  });

  it('hat ohne angemeldete Haken nichts belegt und nichts anzuhalten', async () => {
    (globalThis as { __kompassRestoreHooks?: unknown }).__kompassRestoreHooks = undefined;
    expect(restoreHooks().busyReason()).toBeNull();
    await expect(restoreHooks().pauseBackground()).resolves.toBeUndefined();
    const calls: string[] = [];
    registerRestoreHooks({ busyReason: () => 'siteJobRunning', pauseBackground: async () => void calls.push('p'), resumeBackground: () => void calls.push('r'), afterRestore: async () => void calls.push('a') });
    expect(restoreHooks().busyReason()).toBe('siteJobRunning');
    (globalThis as { __kompassRestoreHooks?: unknown }).__kompassRestoreHooks = undefined;
  });

  it('liest den Zeitpunkt des letzten Publizierens über den Modul-Haken, größter Wert der eingeschalteten Module', async () => {
    const a = defineModule({ key: 'pa', version: '0', permissions: [], lastPublishedAt: () => '2026-10-01T10:00:00.000Z' });
    const b = defineModule({ key: 'pb', version: '0', permissions: [], lastPublishedAt: () => '2026-10-05T10:00:00.000Z' });
    const c = defineModule({ key: 'pc', version: '0', permissions: [], lastPublishedAt: () => '2026-10-09T10:00:00.000Z' });
    const deps = createTestDeps({ manifests: [coreModule, a, b, c] });
    expect(lastPublishedAt(deps)).toBe(null);
    unwrapEnable(deps, ['pa', 'pb']);
    expect(lastPublishedAt(deps)).toBe('2026-10-05T10:00:00.000Z');
  });
});

function unwrapEnable(deps: ReturnType<typeof createTestDeps>, keys: string[]) {
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', keys));
}

// ---------------------------------------------------------------------------------------------------------------
// Der Lauf „Einspielen“ (Task 3). Echte Ein- und Ausgabe: Seed, Backup, Austausch — mehr Zeit statt eines Wacklers.

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-restore-'));
  dirs.push(d);
  return d;
};
let calls: string[] = [];
const hooks = (busy: string | null = null): RestoreHooks => ({
  busyReason: () => (calls.push('busyReason'), busy),
  pauseBackground: async () => void calls.push('pauseBackground'),
  resumeBackground: () => void calls.push('resumeBackground'),
  afterRestore: async () => void calls.push('afterRestore'),
});
beforeEach(() => {
  calls = [];
  registerRestoreHooks(hooks());
});
afterEach(() => {
  vi.restoreAllMocks();
  (globalThis as { __kompassRestoreHooks?: unknown }).__kompassRestoreHooks = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const publishedModule = defineModule({ key: 'pubtest', version: '0', permissions: [], lastPublishedAt: () => '2026-10-23T11:00:00.000Z' });

async function setup(opts: { seed?: boolean; backupPath?: string; modules?: ModuleManifest[] } = {}) {
  const clock = fixedClock('2026-10-23T10:00:00.000Z');
  const deps = createDeps({ dataPath: tmp(), backupPath: opts.backupPath ?? tmp(), env: 'test', clock, modules: opts.modules });
  if (opts.seed !== false) await seedDevelopment(deps);
  const admin = deps.db.select().from(users).all()[0];
  const ctx = ctxWith(['backup.export', 'backup.import'], admin?.id ?? null);
  return { deps, ctx, clock, bp: deps.backupPath!, dp: deps.dataPath };
}

async function createdBackup(deps: AppDeps, ctx: CallContext): Promise<string> {
  const started = launchBackupCreate(deps, ctx, 'manual', 'ui');
  if ('busy' in started) throw new Error('busy');
  return unwrap(await started.done).name;
}

async function restored(deps: AppDeps, start: Result<JobStart>): Promise<JobRecord> {
  const value = unwrap(start);
  if (!value.started) throw new Error('busy');
  return (await waitForJob(backupJobSlot(deps.backupPath!), value.runId))!;
}

const userCount = (deps: AppDeps) => deps.db.select().from(users).all().length;

describe('startRestore', { timeout: 60_000 }, () => {
  it('spielt ein Backup aus der Liste ein und behält Tokens und Backup-Einstellungen der Installation', async () => {
    const { deps, ctx, clock, bp, dp } = await setup();
    const a = await createdBackup(deps, ctx);
    clock.advance(60_000);
    const later = insertUser(deps, { email: 'neu@example.org' });
    const token = unwrap(await createApiToken(deps, ctx, { name: 'sync' }));
    const revoked = unwrap(await createApiToken(deps, ctx, { name: 'alt' }));
    unwrap(await revokeApiToken(deps, ctx, { id: revoked.record.id }));
    unwrap(await createApiToken(deps, ctxWith([], later), { name: 'weg' }));
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, systemContext(), 'backup.maxAgeDays', 14);
      writeSettingInternal(tx, deps, systemContext(), 'backup.schedule.enabled', true);
    });
    mkdirSync(path.join(dp, 'core', 'media'), { recursive: true });
    writeFileSync(path.join(dp, 'core', 'media', 'nachher.png'), 'x');
    mkdirSync(path.join(dp, '.before-import-20250101T000000'));

    const organization = readSetting<string>(deps, 'organization.name') || null;
    const timeZone = timeZoneOf(deps);
    const size = listBackups(bp).find((i) => i.name === a)!.sizeBytes;
    const admin = deps.db.select().from(users).all().find((u) => u.id === ctx.userId)!;
    const start = await startRestore(deps, ctx, { name: a, confirmation: 'test' });
    expect(unwrap(start)).toMatchObject({ started: true, runId: 'restore-20261023-1201' });
    const rec = await restored(deps, start);
    // Die Wartungsseite liest sie ohne Datenbank (Plan U1); das Sichern überschreibt sie nicht.
    expect(rec.meta).toMatchObject({ name: a, startedBy: admin.name, estimatedSeconds: estimateRestoreSeconds(size), timeZone, organization });
    expect(rec).toMatchObject({ status: 'success', steps: BACKUP_JOB_STEPS.restore.map((key) => ({ key, state: 'done' })) });
    expect(rec.result).toMatchObject({ name: a, backupCreatedAt: '2026-10-23T10:00:00.000Z', lastPublishedAt: null, publishedSinceBackup: false });
    expect(deps.db.select().from(users).all().some((u) => u.email === 'neu@example.org')).toBe(false);
    // Die festen Seed-Schlüssel (Anna, Mira) gehören der Installation wie „sync“ und bleiben ebenso.
    const tokens = deps.db.select().from(apiTokens).all().filter((t) => t.name !== 'Seed MCP');
    expect(tokens.map((t) => t.name).sort()).toEqual(['alt', 'sync']);
    expect(tokens.find((t) => t.name === 'alt')!.revokedAt).not.toBeNull();
    expect(tokens.find((t) => t.name === 'sync')!.id).toBe(token.record.id);
    expect(readSetting(deps, 'backup.maxAgeDays')).toBe(14);
    expect(readSetting(deps, 'backup.schedule.enabled')).toBe(true);
    expect(deps.db.select().from(sessions).all()).toEqual([]);
    expect(auditEntry(deps, 'backup.import')).toMatchObject({ channel: 'system', userId: null, entityId: a });
    // Prüfung 2026-10-23: Die übernommenen Einstellungen stehen in diesem einen Eintrag, nicht als zehn
    // `backup.import.mark`; das Manifest dort ohne seine Dateiliste.
    expect(deps.db.select().from(auditLog).all().filter((e) => e.action === 'backup.import.mark')).toEqual([]);
    const imported = JSON.parse(auditEntry(deps, 'backup.import')!.after!) as { files?: unknown; fileCount: number; keptSettings: string[] };
    expect(imported.files).toBeUndefined();
    expect(imported.fileCount).toBeGreaterThan(0);
    expect(imported.keptSettings).toEqual(expect.arrayContaining(['backup.maxAgeDays', 'backup.schedule.enabled', 'system.lastImportAt', 'system.lastImportSource']));
    expect(listBackups(bp).filter((i) => i.kind === 'preRestore')).toHaveLength(1);
    expect(existsSync(path.join(dp, 'core', 'media', 'nachher.png'))).toBe(false);
    expect(readdirSync(dp).filter((n) => n.startsWith('.before-import-'))).toEqual([]);
    expect(readdirSync(bp).filter((n) => n.startsWith('.work-'))).toEqual([]);
    expect(isMaintenanceActive(bp)).toBe(false);
    expect(calls).toEqual(['busyReason', 'pauseBackground', 'resumeBackground', 'afterRestore']);
    deps.close();
  });

  it('legt bei einem Fehler im Schritt migrate den alten Bestand zurück', async () => {
    const { deps, ctx, clock, bp, dp } = await setup();
    const a = await createdBackup(deps, ctx);
    clock.advance(60_000);
    insertUser(deps, { email: 'neu@example.org' });
    const reopen = deps.reopen.bind(deps);
    let first = true;
    vi.spyOn(deps, 'reopen').mockImplementation(() => {
      if (first) {
        first = false;
        throw new Error('migration kaputt');
      }
      reopen();
    });
    const rec = await restored(deps, await startRestore(deps, ctx, { name: a, confirmation: 'test' }));
    expect(rec).toMatchObject({ status: 'failed', lastStep: 'migrate', error: { type: 'conflict', code: 'restoreFailed' } });
    expect(deps.db.select().from(users).all().some((u) => u.email === 'neu@example.org')).toBe(true);
    expect(isMaintenanceActive(bp)).toBe(false);
    expect(readdirSync(dp).filter((n) => n.startsWith('.before-import-'))).toEqual([]);
    expect(calls).toContain('resumeBackground');
    expect(calls).not.toContain('afterRestore');
    deps.close();
  });

  it('verweigert ohne backup.import, bei falscher Bestätigung, über MCP ohne Schalter und lässt MCP mit Schalter durch', async () => {
    const { deps, ctx } = await setup({ seed: false });
    expect(await startRestore(deps, ctxWith(['backup.export']), { name: 'x', confirmation: 'test' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await startRestore(deps, ctx, { name: 'x', confirmation: 'produktion' })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'confirmation', message: 'confirmationMismatch' }] } });
    const mcp = { ...ctx, channel: 'mcp' as const };
    expect(await startRestore(deps, mcp, { name: 'x', confirmation: 'test' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), BACKUP_HUMAN_ONLY_SETTING, true));
    expect(await startRestore(deps, mcp, { name: 'x', confirmation: 'test' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await startRestore(deps, ctx, { confirmation: 'test' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    deps.close();
  });

  it('verweigert ein Backup mit mehr Migrationen nach dem Sichern, ohne etwas zu ersetzen', async () => {
    const { deps, ctx, clock, bp } = await setup();
    const a = await createdBackup(deps, ctx);
    clock.advance(60_000);
    const before = userCount(deps);
    deps.migrationCount -= 1;
    const rec = await restored(deps, await startRestore(deps, ctx, { name: a, confirmation: 'test' }));
    expect(rec).toMatchObject({ status: 'failed', error: { type: 'validation', issues: [{ message: 'backupNewerThanApp' }] } });
    expect(listBackups(bp).filter((i) => i.kind === 'preRestore')).toHaveLength(1);
    expect(userCount(deps)).toBe(before);
    expect(calls).not.toContain('pauseBackground');
    expect(isMaintenanceActive(bp)).toBe(false);
    deps.close();
  });

  it('verweigert mit restoreBlocked, wenn busyReason einen Grund nennt, ohne ein Backup anzulegen', async () => {
    const { deps, ctx, bp } = await setup();
    const a = await createdBackup(deps, ctx);
    registerRestoreHooks(hooks('siteJobRunning'));
    expect(await startRestore(deps, ctx, { name: a, confirmation: 'test' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'restoreBlocked', params: { reason: 'siteJobRunning' } } });
    expect(listBackups(bp)).toHaveLength(1);
    deps.close();
  });

  /**
   * Befundliste 0.4.0, I-E: Der Merker kam erst nach der Sicherung „Vor Einspielen“. Was in deren Minuten geschrieben
   * wurde, fehlte im Backup und ging mit dem Austausch verloren. Jetzt steht er vom Start an (Phase `safeguard`), und
   * ein Abbruch vor dem Austausch nimmt ihn wieder weg.
   */
  it('setzt den Wartungsmerker vor der Sicherung und nimmt ihn bei einem Abbruch davor wieder weg', async () => {
    const { deps, ctx, clock, bp } = await setup();
    const a = await createdBackup(deps, ctx);
    clock.advance(60_000);
    const start = unwrap(await startRestore(deps, ctx, { name: a, confirmation: 'test' }));
    if (!start.started) throw new Error('busy');
    expect(readMaintenance(bp)).toMatchObject({ phase: 'safeguard', runId: start.runId, aside: null });
    expect(requestJobCancel(backupJobSlot(bp), start.runId)).toBe(true);
    const rec = (await waitForJob(backupJobSlot(bp), start.runId))!;
    expect(rec.status).toBe('aborted');
    expect(isMaintenanceActive(bp)).toBe(false);
    deps.close();
  });

  /** Befundliste 0.4.0, N3: Ein Lauf im Hintergrund (Datenexport, Prüfpaket) schriebe über `close()`/`reopen()` weiter. */
  it('verweigert mit restoreBlocked, solange ein anderer Lauf im Hintergrund arbeitet', async () => {
    const { deps, ctx, bp } = await setup();
    const a = await createdBackup(deps, ctx);
    const dir = tmp();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const other = launchJob({ key: `test-export:${dir}`, dir, workDir: dir, tmpPrefix: 'work-' }, deps.clock, { kind: 'dataExport', steps: ['write'], source: 'ui', userId: ctx.userId, apiTokenId: null, runId: 'export-1' }, async () => {
      await held;
      return ok(null);
    });
    if ('busy' in other) throw new Error('busy');
    expect(await startRestore(deps, ctx, { name: a, confirmation: 'test' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'restoreBlocked', params: { reason: 'jobRunning' } } });
    expect(listBackups(bp)).toHaveLength(1);
    release();
    await other.done;
    deps.close();
  });

  it('protokolliert restoreStart im alten Bestand, also im Backup „Vor Einspielen“', async () => {
    const { deps, ctx, clock, bp } = await setup();
    const a = await createdBackup(deps, ctx);
    clock.advance(60_000);
    const before = deps.db.select().from(auditLog).all().length;
    const rec = await restored(deps, await startRestore(deps, ctx, { name: a, confirmation: 'test' }));
    expect(rec.status).toBe('success');
    const pre = listBackups(bp).find((i) => i.kind === 'preRestore')!;
    expect(pre.manifest!.counts.auditEntries).toBeGreaterThan(before);
    expect(deps.db.select().from(auditLog).all().some((e) => e.action === 'backup.restoreStart')).toBe(false);
    deps.close();
  });

  it('legt lastPublishedAt und publishedSinceBackup im Ergebnis ab', async () => {
    const { deps, ctx, clock } = await setup({ modules: [publishedModule] });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['pubtest']));
    const a = await createdBackup(deps, ctx);
    clock.advance(60_000);
    const rec = await restored(deps, await startRestore(deps, ctx, { name: a, confirmation: 'test' }));
    expect(rec.result).toMatchObject({ lastPublishedAt: '2026-10-23T11:00:00.000Z', publishedSinceBackup: true });
    deps.close();
  });

  it('meldet Erfolg, wenn nach dem Austausch nur das Aufräumen scheitert, und legt nichts zurück', async () => {
    const { deps, ctx, clock, bp } = await setup();
    const a = await createdBackup(deps, ctx);
    clock.advance(60_000);
    insertUser(deps, { email: 'neu@example.org' });
    registerRestoreHooks({ ...hooks(), afterRestore: async () => { throw new Error('mcp neu'); } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rec = await restored(deps, await startRestore(deps, ctx, { name: a, confirmation: 'test' }));
    expect(rec).toMatchObject({ status: 'success' });
    expect(deps.db.select().from(users).all().some((u) => u.email === 'neu@example.org')).toBe(false);
    expect(isMaintenanceActive(bp)).toBe(false);
    deps.close();
  });

  it('Zurücklegen scheitert → Merker rollbackFailed bleibt mit aside und contact, kein resumeBackground; recover → stuck', async () => {
    const { deps, ctx, clock, bp, dp } = await setup();
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'organization.email', 'info@example.org'));
    const a = await createdBackup(deps, ctx);
    clock.advance(60_000);
    vi.spyOn(deps, 'reopen').mockImplementation(() => {
      throw new Error('kaputt');
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rec = await restored(deps, await startRestore(deps, ctx, { name: a, confirmation: 'test' }));
    expect(rec).toMatchObject({ status: 'failed', error: { type: 'conflict', code: 'restoreRollbackFailed' } });
    const marker = readMaintenance(bp)!;
    expect(marker).toMatchObject({ phase: 'rollbackFailed', contact: 'info@example.org', backupName: a, runId: 'restore-20261023-1201' });
    expect(marker.aside).toMatch(/\.before-import-/);
    expect(marker.aside!.startsWith(dp)).toBe(true);
    expect(calls).not.toContain('resumeBackground');
    expect(readdirSync(bp).filter((n) => n.startsWith('.work-'))).toEqual([]);
    expect(errors).toHaveBeenCalled();
    expect(recoverInterruptedRestore({ dataPath: dp, backupPath: bp })).toBe('stuck');
    expect(isMaintenanceActive(bp)).toBe(true);
  });
});

describe('startSetupRestore', { timeout: 60_000 }, () => {
  it('spielt ohne Sicherung ein, nur solange keine Nutzer da sind, nicht mit einem Backup ohne Nutzer', async () => {
    const source = await setup();
    const a = await createdBackup(source.deps, source.ctx);
    source.deps.close();
    const empty = await setup({ seed: false, backupPath: source.bp });
    const none = await createdBackup(empty.deps, systemContext());

    const refused = await restored(empty.deps, startSetupRestore(empty.deps, { name: none }));
    expect(refused).toMatchObject({ status: 'failed', error: { type: 'validation', issues: [{ message: 'backupWithoutUsers' }] } });

    const rec = await restored(empty.deps, startSetupRestore(empty.deps, { name: a }));
    expect(rec).toMatchObject({ status: 'success' });
    expect(rec.steps[0]).toMatchObject({ key: 'safeguard', state: 'skipped' });
    expect(isSetupRequired(empty.deps)).toBe(false);
    expect(auditEntry(empty.deps, 'backup.import')).toMatchObject({ channel: 'system', userId: null, entityId: a });
    expect(startSetupRestore(empty.deps, { name: a })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'setupAlreadyDone' } });
    empty.deps.close();
  });
});

describe('recoverInterruptedRestore', () => {
  it('legt nach Neustart im Schritt replace die Rücklage zurück', () => {
    const dp = tmp();
    const bp = tmp();
    writeFileSync(path.join(dp, 'neu.txt'), 'neu');
    const aside = path.join(dp, '.before-import-X');
    mkdirSync(aside);
    writeFileSync(path.join(aside, 'alt.txt'), 'alt');
    writeMaintenance(bp, { runId: 'R', since: 't', phase: 'replace', aside, backupName: 'b', backupCreatedAt: 't', contact: null });
    expect(recoverInterruptedRestore({ dataPath: dp, backupPath: bp })).toBe('rolledBack');
    expect(readdirSync(dp).sort()).toEqual(['alt.txt']);
    expect(isMaintenanceActive(bp)).toBe(false);
  });

  it('Merker done (Neustart beim Aufräumen) → cleared, eingespielter Bestand bleibt, Rücklage weg', () => {
    const dp = tmp();
    const bp = tmp();
    writeFileSync(path.join(dp, 'neu.txt'), 'neu');
    const aside = path.join(dp, '.before-import-X');
    mkdirSync(aside);
    writeFileSync(path.join(aside, 'alt.txt'), 'halb gelöscht');
    writeMaintenance(bp, { runId: 'R', since: 't', phase: 'done', aside, backupName: 'b', backupCreatedAt: 't', contact: null });
    expect(recoverInterruptedRestore({ dataPath: dp, backupPath: bp })).toBe('cleared');
    expect(readdirSync(dp)).toEqual(['neu.txt']);
    expect(isMaintenanceActive(bp)).toBe(false);
  });

  it('Merker prepare → cleared, Daten unberührt; ohne Merker → none', () => {
    const dp = tmp();
    const bp = tmp();
    writeFileSync(path.join(dp, 'neu.txt'), 'neu');
    expect(recoverInterruptedRestore({ dataPath: dp, backupPath: bp })).toBe('none');
    writeMaintenance(bp, { runId: 'R', since: 't', phase: 'prepare', aside: null, backupName: 'b', backupCreatedAt: 't', contact: null });
    expect(recoverInterruptedRestore({ dataPath: dp, backupPath: bp })).toBe('cleared');
    expect(readdirSync(dp)).toEqual(['neu.txt']);
    expect(isMaintenanceActive(bp)).toBe(false);
  });
});

describe('restorePreview', { timeout: 60_000 }, () => {
  it('schätzt die Dauer aus der Größe: zweimal 10 MB/s plus 10 s', () => {
    expect(estimateRestoreSeconds(0)).toBe(10);
    expect(estimateRestoreSeconds(10 * 1024 * 1024)).toBe(12);
  });

  it('zählt Änderungen und Personen seit dem Backup und schätzt die Dauer', async () => {
    const { deps, ctx, clock, bp } = await setup();
    const a = await createdBackup(deps, ctx);
    const size = listBackups(bp).find((i) => i.name === a)!.sizeBytes;
    clock.advance(60_000);
    const [u1, u2] = deps.db.select().from(users).all();
    const note = (userId: string) =>
      deps.db.transaction((tx) => recordAudit(tx, deps, ctxWith([], userId), { action: 'backup.download', entityType: 'backup', entityId: a, params: {} }));
    note(u1!.id);
    note(u1!.id);
    note(u2!.id);
    expect(unwrap(await restorePreview(deps, ctx, { name: a }))).toMatchObject({
      name: a,
      createdAt: '2026-10-23T10:00:00.000Z',
      changesSince: 3,
      personsSince: 2,
      restorable: true,
      pinnedLabel: null,
      counts: { users: 4 },
      estimatedSeconds: estimateRestoreSeconds(size),
    });
    expect(await restorePreview(deps, ctxWith(['backup.export']), { name: a })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await restorePreview(deps, ctx, { name: 'gibt-es-nicht' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    deps.close();
  });
});

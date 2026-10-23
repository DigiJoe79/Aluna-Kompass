import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeps, type AppDeps } from '../src/app';
import { launchBackupCreate } from '../src/backup/create';
import { BACKUP_MAIL_TEXTS, backupAlertRecipients, clearBackupProblem, reportBackupProblem } from '../src/backup/notify';
import { readBackupState, updateBackupState } from '../src/backup/state';
import { fixedClock } from '../src/clock';
import { userRoles } from '../src/db/schema';
import { defineModule } from '../src/modules/manifest';
import { writeSettingInternal } from '../src/settings/service';
import type { SystemMailMessage } from '../src/system-mail';
import { ctxWith, insertRole, insertUser, systemContext } from '../src/testing';

const hooks = vi.hoisted(() => ({
  verify: null as null | { ok: false; reason: 'backupCorrupt'; manifest: null; sha256: null },
  failWrite: false,
  failPrune: false,
}));

vi.mock('../src/backup/verify', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/backup/verify')>();
  return { ...real, verifyBackupArchive: (async (...args: Parameters<typeof real.verifyBackupArchive>) => hooks.verify ?? real.verifyBackupArchive(...args)) as typeof real.verifyBackupArchive };
});
vi.mock('../src/backup/write', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/backup/write')>();
  return {
    ...real,
    writeBackupArchive: (async (source, opts) => {
      if (hooks.failWrite) throw new Error('Platte voll');
      return real.writeBackupArchive(source, opts);
    }) as typeof real.writeBackupArchive,
  };
});
vi.mock('../src/backup/ring', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/backup/ring')>();
  return {
    ...real,
    selectPrunable: ((...args: Parameters<typeof real.selectPrunable>) => {
      if (hooks.failPrune) throw new Error('kein Zugriff');
      return real.selectPrunable(...args);
    }) as typeof real.selectPrunable,
  };
});

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-backup-notify-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  hooks.verify = null;
  hooks.failWrite = false;
  hooks.failPrune = false;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const NOW = '2026-10-23T10:00:00.000Z';

function setup(opts: { mail?: boolean } = {}) {
  const sent: SystemMailMessage[] = [];
  const mailer = defineModule({
    key: 'mailer',
    version: '1',
    permissions: [],
    systemMail: { available: () => true, send: async (_d, m) => { sent.push(m); return { sent: true }; } },
  });
  const clock = fixedClock(NOW);
  const deps = createDeps({ dataPath: tmp(), backupPath: tmp(), env: 'test', clock, modules: [mailer] });
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, systemContext(), 'organization.name', 'Beispielverein');
    if (opts.mail !== false) writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['mailer']);
  });
  const adminRole = insertRole(deps, { name: 'Admin', isProtected: true });
  const auditorRole = insertRole(deps, { name: 'Kassenprüfung' });
  const grant = (userId: string, roleId: string) => deps.db.insert(userRoles).values({ userId, roleId }).run();
  const admin = insertUser(deps, { name: 'Admin', email: 'admin@example.org' });
  grant(admin, adminRole);
  grant(insertUser(deps, { name: 'Prüferin', email: 'pruef@example.org' }), auditorRole);
  grant(insertUser(deps, { name: 'Alt', email: 'alt@example.org', isActive: false }), adminRole);
  grant(insertUser(deps, { name: 'Kaputt', email: 'kaputt' }), adminRole);
  return { deps, clock, sent, admin, bp: deps.backupPath! };
}

async function create(deps: AppDeps, kind: 'automatic' | 'manual') {
  const started = launchBackupCreate(deps, ctxWith(['backup.export'], null), kind, 'system');
  if ('busy' in started) throw new Error('busy');
  return started.done;
}

describe('Meldungen zum Backup', { timeout: 20_000 }, () => {
  it('Empfänger: aktive Nutzer mit backup.export und gültiger Adresse', () => {
    const { deps, admin } = setup();
    expect(backupAlertRecipients(deps)).toEqual([{ userId: admin, email: 'admin@example.org' }]);
    deps.close();
  });

  it('merkt den Fehler, schreibt je Empfänger eine Mail in der Leitsprache und markiert mailed', async () => {
    const { deps, sent, bp } = setup();
    expect(await reportBackupProblem(deps, { code: 'createFailed', kind: 'automatic', name: null, reason: 'writeFailed' })).toEqual({ mailed: 1 });
    expect(readBackupState(bp).lastError).toEqual({ code: 'createFailed', kind: 'automatic', name: null, reason: 'writeFailed', at: NOW, mailed: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('admin@example.org');
    expect(sent[0]!.subject).toBe(BACKUP_MAIL_TEXTS.de!.subject.replace('{Umgebung}', 'test'));
    expect(sent[0]!.text).toContain(BACKUP_MAIL_TEXTS.de!.problems.createFailed);
    expect(sent[0]!.text).toContain('Beispielverein');
    expect(sent[0]!.text).not.toMatch(/\{[A-Za-z]+\}/);
    deps.close();
  });

  it('mailt und loggt auch, wenn sich die Zustandsdatei nicht schreiben lässt', async () => {
    const { deps, sent, bp } = setup();
    rmSync(path.join(bp, '.jobs'), { recursive: true, force: true });
    writeFileSync(path.join(bp, '.jobs'), 'kein Verzeichnis');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await reportBackupProblem(deps, { code: 'createFailed', kind: 'automatic', name: null, reason: 'writeFailed' })).toEqual({ mailed: 1 });
    expect(await reportBackupProblem(deps, { code: 'storageLow', kind: null, name: null, reason: null })).toEqual({ mailed: 1 });
    expect(sent).toHaveLength(2);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    deps.close();
  });

  it('nicht beschreibbares Verzeichnis: höchstens eine Mail je Vereinstag, auch ohne Zustandsdatei (Takt alle 10 min)', async () => {
    const { deps, sent, clock, bp } = setup();
    rmSync(path.join(bp, '.jobs'), { recursive: true, force: true });
    writeFileSync(path.join(bp, '.jobs'), 'kein Verzeichnis');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const report = () => reportBackupProblem(deps, { code: 'backupPathUnwritable', kind: 'automatic', name: null, reason: null });
    expect(await report()).toEqual({ mailed: 1 });
    clock.advance(10 * 60_000);
    expect(await report()).toEqual({ mailed: 0 });
    expect(await reportBackupProblem(deps, { code: 'storageLow', kind: null, name: null, reason: null })).toEqual({ mailed: 1 });
    expect(await reportBackupProblem(deps, { code: 'storageLow', kind: null, name: null, reason: null })).toEqual({ mailed: 0 });
    expect(sent).toHaveLength(2);
    clock.advance(24 * 3_600_000);
    expect(await report()).toEqual({ mailed: 1 });
    log.mockRestore();
    deps.close();
  });

  it('storageLow und notMounted: kein lastError, höchstens eine Mail je Vereinstag', async () => {
    const { deps, sent, clock, bp } = setup();
    expect(await reportBackupProblem(deps, { code: 'storageLow', kind: null, name: null, reason: null })).toEqual({ mailed: 1 });
    clock.advance(10 * 60_000);
    expect(await reportBackupProblem(deps, { code: 'storageLow', kind: null, name: null, reason: null })).toEqual({ mailed: 0 });
    expect(await reportBackupProblem(deps, { code: 'notMounted', kind: null, name: null, reason: null })).toEqual({ mailed: 1 });
    clock.advance(20 * 60_000);
    expect(await reportBackupProblem(deps, { code: 'storageLow', kind: null, name: null, reason: null })).toEqual({ mailed: 0 });
    expect(readBackupState(bp).lastError).toBeNull();
    expect(sent).toHaveLength(2);
    clock.advance(24 * 3_600_000);
    expect(await reportBackupProblem(deps, { code: 'storageLow', kind: null, name: null, reason: null })).toEqual({ mailed: 1 });
    deps.close();
  });

  it('ohne Versandweg: lastError mit mailed false, kein Wurf', async () => {
    const { deps, sent, bp } = setup({ mail: false });
    expect(await reportBackupProblem(deps, { code: 'pruneFailed', kind: 'manual', name: 'x', reason: 'kein Zugriff' })).toEqual({ mailed: 0 });
    expect(readBackupState(bp).lastError).toMatchObject({ code: 'pruneFailed', mailed: false });
    expect(sent).toEqual([]);
    deps.close();
  });

  it('clearBackupProblem löscht lastError, lässt die Tageszähler', async () => {
    const { deps, bp } = setup();
    await reportBackupProblem(deps, { code: 'storageLow', kind: null, name: null, reason: null });
    await reportBackupProblem(deps, { code: 'verifyFailed', kind: 'manual', name: 'x', reason: 'backupCorrupt' });
    clearBackupProblem(bp);
    expect(readBackupState(bp)).toMatchObject({ lastError: null, warningMailDay: { storageLow: '2026-10-23', notMounted: null } });
    deps.close();
  });

  it('eine kaputte Zustandsdatei liest sich als Vorgabe; update mischt warningMailDay tief', () => {
    const bp = tmp();
    expect(readBackupState(bp)).toEqual({ lastError: null, lastScheduleAttemptDay: null, warningMailDay: { storageLow: null, notMounted: null, backupPathUnwritable: null }, lastReportedRunId: null });
    updateBackupState(bp, { warningMailDay: { storageLow: '2026-10-23', notMounted: null, backupPathUnwritable: null } });
    updateBackupState(bp, { lastScheduleAttemptDay: '2026-10-23' });
    expect(readBackupState(bp)).toMatchObject({ lastScheduleAttemptDay: '2026-10-23', warningMailDay: { storageLow: '2026-10-23' } });
  });

  it('ein gelungenes Backup löscht den letzten Fehler; ein automatisches mit gescheiterter Prüfung meldet verifyFailed; ein Von Hand mit Schreibfehler meldet nichts', async () => {
    const { deps, sent, bp } = setup();
    hooks.verify = { ok: false, reason: 'backupCorrupt', manifest: null, sha256: null };
    expect((await create(deps, 'automatic')).ok).toBe(false);
    expect(readBackupState(bp).lastError).toMatchObject({ code: 'verifyFailed', kind: 'automatic', reason: 'backupCorrupt', mailed: true });
    hooks.verify = null;
    expect((await create(deps, 'manual')).ok).toBe(true);
    expect(readBackupState(bp).lastError).toBeNull();
    hooks.failWrite = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await create(deps, 'manual').catch(() => undefined);
    expect(readBackupState(bp).lastError).toBeNull();
    await create(deps, 'automatic').catch(() => undefined);
    expect(readBackupState(bp).lastError).toMatchObject({ code: 'createFailed', kind: 'automatic', reason: 'writeFailed' });
    errors.mockRestore();
    expect(sent).toHaveLength(2);
    deps.close();
  });

  it('pruneError im Ergebnis meldet pruneFailed', async () => {
    const { deps, bp } = setup();
    hooks.failPrune = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await create(deps, 'manual');
    errors.mockRestore();
    expect(result.ok && result.value.pruneError).toBe('kein Zugriff');
    expect(readBackupState(bp).lastError).toMatchObject({ code: 'pruneFailed', kind: 'manual', reason: 'kein Zugriff' });
    deps.close();
  });
});

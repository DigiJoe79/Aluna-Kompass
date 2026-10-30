import type { BackupSidecar, RuntimeEnv } from '@kompass/core';
import { describe, expect, it, vi } from 'vitest';
import { preUpdateGate } from '../src/lib/pre-update';

const env: RuntimeEnv = {
  env: 'production',
  dataPath: '/data',
  backupPath: '/backups',
  inImage: true,
  port: 3000,
  sessionSecret: 'x'.repeat(32),
  documentTemplatesDir: null,
  handbookDir: null,
  skipUpdateBackup: false,
  publicUrl: null,
};
const sidecar = { name: 'kompass-backup-production-20261023-030000-preUpdate', kind: 'preUpdate' } as BackupSidecar;
const NOW = new Date('2026-10-23T03:00:00.000Z');

function io(run: (...args: never[]) => Promise<unknown>) {
  const exit = vi.fn((code: number) => {
    throw new Error(`exit ${code}`);
  }) as unknown as (code: number) => never;
  const log = { warn: vi.fn(), error: vi.fn(), log: vi.fn() };
  return { run: vi.fn(run) as never, exit, log, now: () => NOW };
}

describe('Backup vor Update beim Start', () => {
  it('Scheitern → exit(1) und Log mit KOMPASS_SKIP_UPDATE_BACKUP', async () => {
    const o = io(async () => {
      throw new Error('backupPathUnwritable: /backups');
    });
    await expect(preUpdateGate(env, o)).rejects.toThrow('exit 1');
    expect(o.exit).toHaveBeenCalledWith(1);
    const [format, message] = o.log.error.mock.calls[0]!;
    expect(`${format} ${message}`).toContain('KOMPASS_SKIP_UPDATE_BACKUP=1');
    expect(message).toContain('backupPathUnwritable');
  });

  it('skip → run nicht gerufen, Warnung', async () => {
    const o = io(async () => ({ status: 'done', sidecar }));
    expect(await preUpdateGate({ ...env, skipUpdateBackup: true }, o)).toBeNull();
    expect(o.run).not.toHaveBeenCalled();
    expect(o.log.warn).toHaveBeenCalledWith(expect.stringContaining('KOMPASS_SKIP_UPDATE_BACKUP=1'));
  });

  it('ok → Begleitdatei; nichts anstehend → null; run bekommt Pfade, Fassung und Uhr', async () => {
    const done = io(async () => ({ status: 'done', sidecar }));
    expect(await preUpdateGate(env, done)).toBe(sidecar);
    expect(done.run).toHaveBeenCalledWith(expect.objectContaining({ dataPath: '/data', backupPath: '/backups', env: 'production', now: NOW, appVersion: expect.any(String), migrationsFolder: expect.any(String) }));
    const none = io(async () => ({ status: 'notNeeded' }));
    expect(await preUpdateGate(env, none)).toBeNull();
    expect(none.exit).not.toHaveBeenCalled();
  });
});

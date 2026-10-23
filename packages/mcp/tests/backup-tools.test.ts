import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  backupJobSlot, createDeps, fixedClock, unwrap, waitForJob, writeSettingInternal,
  type AppDeps, type JobStart,
} from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { coreMcpTools } from '../src/core-tools';

const tool = (name: string) => {
  const found = coreMcpTools.find((t) => t.name === name);
  if (!found) throw new Error(`kein Werkzeug ${name}`);
  return found;
};

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-mcp-backup-'));
  dirs.push(d);
  return d;
};
const open: AppDeps[] = [];
afterEach(() => {
  for (const deps of open.splice(0)) deps.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const deps = createDeps({ dataPath: tmp(), backupPath: tmp(), env: 'test', clock: fixedClock('2026-10-23T10:00:00.000Z') });
  open.push(deps);
  insertUser(deps, { id: 'USER-TEST' });
  const ctx = { ...ctxWith(['backup.export', 'backup.import']), channel: 'mcp' as const };
  return { deps, ctx };
}

async function finished(deps: AppDeps, start: unknown) {
  const value = start as JobStart;
  if (!value.started) throw new Error('busy');
  return (await waitForJob(backupJobSlot(deps.backupPath!), value.runId))!;
}

describe('Backup-Werkzeuge', { timeout: 60_000 }, () => {
  it('backup_create startet, backup_job_status zeigt den Lauf, backup_list danach das Backup mit retention', async () => {
    const { deps, ctx } = setup();
    const start = unwrap(await tool('backup_create').handler(deps, ctx, {}));
    expect(start).toMatchObject({ started: true });
    expect(unwrap(await tool('backup_job_status').handler(deps, ctx, {}))).toMatchObject({ running: { runId: (start as { runId: string }).runId } });
    await finished(deps, start);
    expect(unwrap(await tool('backup_list').handler(deps, ctx, {}))).toMatchObject({
      items: [{ kind: 'manual', verification: { status: 'passed' }, retention: { kind: 'untilNextManual' } }],
    });
  });

  it('backup_pin, backup_unpin, backup_verify, backup_restore_preview und backup_delete rufen ihre Dienste', async () => {
    const { deps, ctx } = setup();
    await finished(deps, unwrap(await tool('backup_create').handler(deps, ctx, {})));
    const { items } = unwrap(await tool('backup_list').handler(deps, ctx, {})) as { items: { name: string }[] };
    const name = items[0]!.name;
    expect(unwrap(await tool('backup_pin').handler(deps, ctx, { name, label: 'Vor dem Umzug' }))).toMatchObject({ pinned: true, pinnedLabel: 'Vor dem Umzug' });
    expect(unwrap(await tool('backup_unpin').handler(deps, ctx, { name }))).toMatchObject({ pinned: false });
    expect(await finished(deps, unwrap(await tool('backup_verify').handler(deps, ctx, { name })))).toMatchObject({ status: 'success' });
    expect(unwrap(await tool('backup_restore_preview').handler(deps, ctx, { name }))).toMatchObject({ name });
    const refused = await tool('backup_delete').handler(deps, ctx, { name });
    expect(refused.ok).toBe(false);
  });

  it('backup_restore ohne Schalter humanOnly, mit Schalter gestartet', async () => {
    const { deps, ctx } = setup();
    await finished(deps, unwrap(await tool('backup_create').handler(deps, ctx, {})));
    const { items } = unwrap(await tool('backup_list').handler(deps, ctx, {})) as { items: { name: string }[] };
    const name = items[0]!.name;
    const refused = await tool('backup_restore').handler(deps, ctx, { name, confirmation: 'test' });
    expect(refused.ok === false && refused.error.type === 'conflict' && refused.error.code).toBe('humanOnly');
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'backup.mcpHumanOnlyAllowed', true));
    const started = unwrap(await tool('backup_restore').handler(deps, ctx, { name, confirmation: 'test' }));
    expect(started).toMatchObject({ started: true });
    await finished(deps, started);
  });

  it('jedes Backup-Werkzeug nennt sein Recht; backup_restore trägt den festen Human-only-Satz', () => {
    const backupTools = coreMcpTools.filter((t) => t.name.startsWith('backup_'));
    expect(backupTools.map((t) => t.name).sort()).toEqual([
      'backup_create', 'backup_delete', 'backup_job_cancel', 'backup_job_status', 'backup_list', 'backup_pin',
      'backup_restore', 'backup_restore_preview', 'backup_unpin', 'backup_verify',
    ]);
    for (const t of backupTools) expect(t.description).toMatch(/Requires backup\.(export|import)\./);
    expect(tool('backup_restore').description).toContain('Human only: refused over MCP unless the association has set backup.mcpHumanOnlyAllowed at the screen.');
  });

  it('ohne Backup-Verzeichnis bzw. ohne AppDeps: backupPathMissing', async () => {
    const ctx = { ...ctxWith(['backup.export', 'backup.import']), channel: 'mcp' as const };
    const r = await tool('backup_list').handler(createTestDeps(), ctx, {});
    expect(r.ok === false && r.error.type === 'conflict' && r.error.code).toBe('backupPathMissing');
    const noPath = createDeps({ dataPath: tmp(), env: 'test' });
    open.push(noPath);
    const r2 = await tool('backup_create').handler(noPath, ctx, {});
    expect(r2.ok === false && r2.error.type === 'conflict' && r2.error.code).toBe('backupPathMissing');
  });

  // Prüfung 2026-10-23, Befund 2: Die Dateiliste eines Backups (bei Prod Zehntausende Pfade) gehört nicht in ein Modell.
  it('keine Antwort trägt die Dateiliste eines Backups, nur ihre Anzahl', async () => {
    const { deps, ctx } = setup();
    const start = unwrap(await tool('backup_create').handler(deps, ctx, {}));
    await finished(deps, start);
    const { items } = unwrap(await tool('backup_list').handler(deps, ctx, {})) as { items: { name: string; manifest: { fileCount: number } }[] };
    const name = items[0]!.name;
    expect(items[0]!.manifest.fileCount).toBeGreaterThan(0);
    const answers = [
      { items },
      unwrap(await tool('backup_job_status').handler(deps, ctx, {})),
      unwrap(await tool('backup_pin').handler(deps, ctx, { name })),
      unwrap(await tool('backup_unpin').handler(deps, ctx, { name })),
      unwrap(await tool('backup_restore_preview').handler(deps, ctx, { name })),
    ];
    for (const answer of answers) expect(JSON.stringify(answer)).not.toMatch(/"files":\[/);
  });

  it('backup_pin und backup_unpin sagen, dass ein zweiter Aufruf nichts ändert', () => {
    expect(tool('backup_pin').description).toMatch(/already pinned only replaces its label/i);
    expect(tool('backup_unpin').description).toMatch(/not pinned.*unchanged/i);
  });

  it('es gibt kein Download-Werkzeug', () => expect(coreMcpTools.some((t) => /download/.test(t.name))).toBe(false));
});

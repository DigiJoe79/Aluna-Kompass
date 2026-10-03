import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { conflict, ok, type Result } from '@kompass/core';
import { runChild } from './child';
import { classifyDeployError, type DeployProblem } from './deploy-errors';
import type { DeployTarget, SiteEnv } from './env';
import { limitFor } from './limits';
import { remoteDir, rsyncWith } from './publish';
import { SITE_JOB_TMP_PREFIX, workRoot, type RunHandle } from './run-state';
import { JobAbortedError, removeQuietly, step } from './step';

export type DeployCheckKey = 'connect' | 'targetDir' | 'writable' | 'targetFiles';
export interface DeployCheckItem {
  key: DeployCheckKey;
  outcome: 'ok' | 'failed' | 'skipped' | 'notRun';
  problem?: DeployProblem;
}
export interface DeployCheckResult {
  /** Das Ziel, wie rsync es anspricht — user@host:pfad oder ein lokaler Pfad. */
  target: string;
  /** Alle Prüfpunkte bestanden (oder bei einem lokalen Ziel entfallen). */
  passed: boolean;
  checks: DeployCheckItem[];
  /** Die Dateien am Ziel, ohne die Probedatei. */
  filesAtTarget: string[];
  log: string;
}

const KEYS: DeployCheckKey[] = ['connect', 'targetDir', 'writable', 'targetFiles'];
const PROBE_PREFIX = '.kompass-probe-';
/** Dieselben Schonflags wie beim Publish: Besitzer, Gruppe, Rechte und Verzeichniszeiten gehören dem Ziel. */
const SPARING = ['-az', '--no-owner', '--no-group', '--no-perms', '--omit-dir-times'];

/**
 * Nur reguläre Dateien aus `rsync --list-only`, GNU wie openrsync. GNU setzt
 * Tausendertrenner in die Größe, openrsync lässt sie bei 0 Byte ganz weg
 * (gemessen am 2026-10-03).
 */
export function parseListing(out: string): string[] {
  const files: string[] = [];
  for (const line of out.split('\n')) {
    const m = /^-\S*\s+(?:[\d.,]+\s+)?\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\s+(.+)$/.exec(line);
    if (m?.[1]) files.push(m[1]);
  }
  return files;
}

export interface DeployCheckIo {
  rsync(
    args: { command: string; args: string[] },
    opts: { signal: AbortSignal; timeoutMs: number; onLine?: (line: string) => void },
  ): Promise<{ code: number | null; log: string }>;
}

const realIo: DeployCheckIo = { rsync: ({ command, args }, opts) => runChild(command, args, opts) };

/**
 * Der Verbindungstest: vier Prüfpunkte, alle nur mit rsync und ohne Shell am
 * Ziel (Hoster mit `rrsync` gehen damit auch). Ein Fehlschlag beendet die
 * Prüfung, die übrigen Punkte stehen dann als `notRun`. Der Lauf selbst endet
 * trotzdem als Erfolg: Das Ergebnis trägt die Einzelbefunde.
 */
export async function runDeployCheck(h: RunHandle, env: SiteEnv, deploy: DeployTarget, io: DeployCheckIo = realIo): Promise<Result<DeployCheckResult>> {
  const target = deploy.host ? `${deploy.user}@${deploy.host}:${deploy.path}` : deploy.path;
  const dir = remoteDir(deploy);
  const checks: DeployCheckItem[] = KEYS.map((key) => ({ key, outcome: 'notRun' as const }));
  const at = (key: DeployCheckKey) => checks.find((c) => c.key === key)!;
  const lines: string[] = [`Ziel: ${target}`];
  let filesAtTarget: string[] = [];

  const scratch = await mkdtemp(path.join(workRoot(env), `${SITE_JOB_TMP_PREFIX}deploy-check-`));
  try {
    const run = async (key: DeployCheckKey, c: { signal: AbortSignal }, flags: string[], operands: string[], onLine?: (l: string) => void) => {
      const cmd = rsyncWith(deploy, flags, operands);
      try {
        const { code, log } = await io.rsync(cmd, { signal: c.signal, timeoutMs: limitFor(env, key).totalMs, onLine });
        return { code, log };
      } catch (error) {
        if (c.signal.aborted) throw error;
        return { code: -1, log: error instanceof Error ? error.message : String(error) };
      }
    };
    const fail = (item: DeployCheckItem, stage: Parameters<typeof classifyDeployError>[1], log: string, problem?: DeployProblem) => {
      item.outcome = 'failed';
      item.problem = problem ?? classifyDeployError(log, stage);
      lines.push(`Prüfpunkt ${item.key}: ${item.problem}`, ...log.trim().split('\n').slice(-20));
    };
    const passed = (item: DeployCheckItem) => {
      item.outcome = 'ok';
      lines.push(`Prüfpunkt ${item.key}: ok`);
    };
    const failedSoFar = () => checks.some((c) => c.outcome === 'failed');

    // 1. Anmelden: nur mit Host. Das Home-Verzeichnis zu listen reicht.
    if (!deploy.host) {
      await step(h, 'connect', limitFor(env, 'connect'), async () => undefined, { endAs: 'skipped' });
      at('connect').outcome = 'skipped';
      lines.push('Prüfpunkt connect: entfällt (lokales Ziel)');
    } else {
      await step(h, 'connect', limitFor(env, 'connect'), async (c) => {
        const { code, log } = await run('connect', c, ['--list-only'], [`${deploy.user}@${deploy.host}:`]);
        if (code === 0) passed(at('connect'));
        else fail(at('connect'), 'connect', log);
      });
    }

    // 2. Zielverzeichnis vorhanden.
    if (!failedSoFar()) {
      await step(h, 'targetDir', limitFor(env, 'targetDir'), async (c) => {
        const { code, log } = await run('targetDir', c, ['--list-only'], [dir]);
        if (code === 0) passed(at('targetDir'));
        else fail(at('targetDir'), 'targetDir', log);
      });
    }

    // 3. Beschreibbar: Probedatei hoch und mit --delete wieder weg. Ausgeschlossenes
    // ist vor --delete geschützt, gelöscht wird nur die Probe.
    const probe = `${PROBE_PREFIX}${h.run.runId}`;
    if (!failedSoFar()) {
      await step(h, 'writable', limitFor(env, 'writable'), async (c) => {
        const probeFile = path.join(scratch, probe);
        await writeFile(probeFile, 'kompass');
        const up = await run('writable', c, SPARING, [probeFile, dir]);
        if (up.code !== 0) return fail(at('writable'), 'writable', up.log);
        const emptyDir = path.join(scratch, 'empty');
        await mkdir(emptyDir);
        const down = await run('writable', c, ['-r', '--delete', `--include=/${probe}`, '--exclude=*'], [`${emptyDir}/`, dir]);
        if (down.code !== 0) return fail(at('writable'), 'writable', down.log);
        passed(at('writable'));
      });
    }

    // 4. Dateien am Ziel zählen; bleibt die Probe in der Liste, ließ sie sich nicht löschen.
    if (!failedSoFar()) {
      await step(h, 'targetFiles', limitFor(env, 'targetFiles'), async (c) => {
        let n = 0;
        const { code, log } = await run('targetFiles', c, ['-r', '--list-only'], [dir], (line) => {
          if (parseListing(line).length > 0) c.progress(++n);
        });
        if (code !== 0) return fail(at('targetFiles'), 'targetDir', log);
        const all = parseListing(log);
        filesAtTarget = all.filter((f) => path.posix.basename(f) !== probe);
        passed(at('targetFiles'));
        if (all.length !== filesAtTarget.length) {
          const writable = at('writable');
          writable.outcome = 'failed';
          writable.problem = 'probeLeft';
          lines.push(`Prüfpunkt writable: probeLeft (${probe} liegt noch am Ziel und ließ sich nicht löschen)`);
        }
        lines.push(`Dateien am Ziel: ${filesAtTarget.length}`, ...filesAtTarget.map((f) => `am Ziel: ${f}`));
      });
    }

    return ok({ target, passed: checks.every((c) => c.outcome === 'ok' || c.outcome === 'skipped'), checks, filesAtTarget, log: lines.join('\n') });
  } catch (error) {
    if (error instanceof JobAbortedError) throw error;
    return conflict('deployCheckFailed', (error instanceof Error ? error.message : String(error)).slice(0, 2000));
  } finally {
    await removeQuietly(scratch);
  }
}

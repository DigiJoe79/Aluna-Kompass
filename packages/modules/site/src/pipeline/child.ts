import { spawn } from 'node:child_process';

export class ChildTimeoutError extends Error {
  constructor(
    readonly command: string,
    readonly log: string,
  ) {
    super(`${command} timed out`);
    this.name = 'ChildTimeoutError';
  }
}

const killGroup = (pid: number | undefined, sig: NodeJS.Signals): void => {
  if (!pid) return;
  try {
    process.kill(-pid, sig);
  } catch {
    // Gruppe schon weg
  }
};
const groupAlive = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Startet ein Kommando als eigene Prozessgruppe. Abbruch und Zeitlimit
 * beenden die ganze Gruppe — sshpass→rsync→ssh und Astros Worker enden mit —:
 * erst SIGTERM, nach 5 s SIGKILL. Das Versprechen endet erst, wenn die
 * Gruppe wirklich weg ist; vorher wäre der Riegel des Laufs frei, während
 * noch ein Kind schreibt.
 */
export function runChild(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs?: number; clean?: (s: string) => string; onLine?: (line: string) => void },
): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let log = '';
    let pending = '';
    let stoppedBy: Error | null = null;
    const stop = (why: Error) => {
      if (stoppedBy) return;
      stoppedBy = why;
      killGroup(child.pid, 'SIGTERM');
    };
    const timer = opts.timeoutMs ? setTimeout(() => stop(new ChildTimeoutError(command, log)), opts.timeoutMs) : undefined;
    const onAbort = () => stop(opts.signal!.reason instanceof Error ? opts.signal!.reason : new Error('aborted'));
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    if (opts.signal?.aborted) onAbort();
    const take = (chunk: Buffer) => {
      const text = (opts.clean ?? ((s: string) => s))(chunk.toString('utf8'));
      log += text;
      pending += text;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) opts.onLine?.(line);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const cleanup = () => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    };
    child.on('error', (e) => {
      cleanup();
      reject(new Error(`${command} failed to start: ${e.message}`));
    });
    child.on('close', (code) => {
      cleanup();
      void (async () => {
        if (!stoppedBy) {
          resolve({ code, log });
          return;
        }
        // Der Anführer ist weg; Nachzügler, die SIGTERM ignorieren, bekommen
        // bis zu 5 s, dann SIGKILL an die Gruppe.
        for (let waited = 0; child.pid && groupAlive(child.pid) && waited < 5_000; waited += 50) await pause(50);
        killGroup(child.pid, 'SIGKILL');
        // SIGKILL wirkt nicht sofort: Erst wenn die Gruppe leer ist, gilt der Lauf als beendet.
        for (let waited = 0; child.pid && groupAlive(child.pid) && waited < 2_000; waited += 20) await pause(20);
        reject(stoppedBy instanceof ChildTimeoutError ? new ChildTimeoutError(command, log) : stoppedBy);
      })();
    });
  });
}

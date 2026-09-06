import { spawn } from 'node:child_process';
import type { DeployTarget } from './env';

// ConnectTimeout: eine haengende Verbindung soll scheitern, nicht warten.
// NumberOfPasswordPrompts=1: bei falschem Passwort einmal versuchen und
// aufgeben, statt erneut zu fragen und dann auf eine Eingabe zu warten, die
// es nie gibt — stdin ist geschlossen.
const SSH_BASE = '-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o NumberOfPasswordPrompts=1';

/**
 * Baut die Kommandozeile für die Übertragung. Rein, damit sie prüfbar ist,
 * ohne rsync zu starten — die Zeile entscheidet über Anmeldung und Zielpfad.
 */
export function rsyncCommand(opts: { distDir: string; deploy: DeployTarget; dryRun?: boolean }): {
  command: string;
  args: string[];
} {
  const { deploy } = opts;
  const remote = deploy.host
    ? `${deploy.user}@${deploy.host}:${deploy.path.replace(/\/?$/, '/')}`
    : deploy.path.replace(/\/?$/, '/');
  const src = opts.distDir.endsWith('/') ? opts.distDir : `${opts.distDir}/`;
  const flags = ['-az', '--delete', '--checksum', ...(opts.dryRun ? ['--dry-run'] : [])];

  switch (deploy.auth.kind) {
    case 'key':
      // BatchMode: lieber sofort scheitern als auf eine Eingabe warten, die nie kommt.
      return { command: 'rsync', args: [...flags, '-e', `ssh -i ${deploy.auth.keyFile} ${SSH_BASE} -o BatchMode=yes`, src, remote] };
    case 'password':
      // sshpass liest das Passwort aus der Datei, damit es nicht in der
      // Prozessliste steht. BatchMode muss hier fehlen, sonst kein Login.
      return {
        command: 'sshpass',
        args: ['-f', deploy.auth.passwordFile, 'rsync', ...flags, '-e', `ssh ${SSH_BASE} -o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no`, src, remote],
      };
    case 'none':
      return { command: 'rsync', args: [...flags, src, remote] };
  }
}

export async function rsyncPublish(opts: {
  distDir: string;
  deploy: DeployTarget;
  dryRun?: boolean;
  timeoutMs?: number;
}): Promise<{ log: string }> {
  const { command, args } = rsyncCommand(opts);
  const line = `${command} ${args.join(' ')}`;
  console.log(`[site] Uebertragen: ${line}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = `${line}\n`;
    // Ohne Zeitgrenze wartet ein blockiertes ssh endlos, und der Publish
    // haengt ohne Fehler und ohne Protokoll.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} hat das Zeitlimit ueberschritten\n${log}`));
    }, opts.timeoutMs ?? 600_000);
    child.stdout.on('data', (c: Buffer) => {
      log += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      log += c.toString('utf8');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`${command} failed to start: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ log });
      else reject(new Error(`${command} exited with ${code}\n${log}`));
    });
  });
}

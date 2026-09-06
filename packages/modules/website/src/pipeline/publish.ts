import { spawn } from 'node:child_process';
import type { DeployTarget } from './env';

const SSH_BASE = '-o StrictHostKeyChecking=accept-new';

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

export async function rsyncPublish(opts: { distDir: string; deploy: DeployTarget; dryRun?: boolean }): Promise<{ log: string }> {
  const { command, args } = rsyncCommand(opts);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = `${command} ${args.join(' ')}\n`;
    child.stdout.on('data', (c: Buffer) => {
      log += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      log += c.toString('utf8');
    });
    child.on('error', (e) => reject(new Error(`${command} failed to start: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve({ log }) : reject(new Error(`${command} exited with ${code}\n${log}`))));
  });
}

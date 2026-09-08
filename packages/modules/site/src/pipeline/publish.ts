import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
  // --no-owner/--no-group/--no-perms: `-a` enthaelt `-ogp` und laesst rsync
  // versuchen, Besitzer, Gruppe und Rechte am Zielverzeichnis selbst zu setzen.
  // Gehoert es jemand anderem — auf einem Webspace der Regelfall —, bricht der
  // Lauf mit „failed to set permissions on \"…/.\": Operation not permitted" ab.
  // Eine ausgelieferte Webseite braucht nichts davon: Die Dateien bekommen die
  // Vorgaben des Ziels (644 fuer Dateien, 755 fuer Verzeichnisse), und genau
  // die will ein Webserver. Zeiten und Symlinks bleiben erhalten.
  // --itemize-changes nur im Trockenlauf: ohne es schweigt rsync, und der
  // Verbindungstest haette kein Protokoll, aus dem der Zielinhalt hervorgeht.
  const flags = ['-az', '--no-owner', '--no-group', '--no-perms', '--delete', '--checksum', ...(opts.dryRun ? ['--dry-run', '--itemize-changes'] : [])];

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


/**
 * Prueft vor dem Publish, ob die Anmeldedaten ueberhaupt brauchbar sind.
 * Ohne das aeussert sich eine unlesbare Datei erst als undurchsichtiges
 * Verhalten von ssh — im Container gehoert sie leicht dem falschen Nutzer,
 * weil die Eigentuemerschaft vom Wirtssystem kommt.
 *
 * @returns Klartext-Begruendung oder null, wenn alles stimmt.
 */
export async function checkDeployCredentials(deploy: DeployTarget): Promise<string | null> {
  const file =
    deploy.auth.kind === 'password' ? deploy.auth.passwordFile : deploy.auth.kind === 'key' ? deploy.auth.keyFile : null;
  if (!file) return null;
  let content: Buffer;
  try {
    content = await readFile(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const hint =
      code === 'EACCES'
        ? ' Die Datei gehoert einem anderen Nutzer; auf dem Wirtssystem `chown 1000:1000` setzen.'
        : '';
    return `${file} ist nicht lesbar (${code ?? 'Fehler'}).${hint}`;
  }
  if (deploy.auth.kind !== 'password') return null;
  if (content.length === 0) return `${file} ist leer.`;
  if (/[\r\n]$/.test(content.toString('utf8'))) {
    return `${file} endet mit einem Zeilenumbruch; der gehoert zum Passwort. Mit printf statt echo schreiben.`;
  }
  return null;
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

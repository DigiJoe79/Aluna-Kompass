import { readFile } from 'node:fs/promises';
import { ChildTimeoutError, runChild } from './child';
import type { DeployTarget } from './env';

// ConnectTimeout: eine haengende Verbindung soll scheitern, nicht warten.
// NumberOfPasswordPrompts=1: bei falschem Passwort einmal versuchen und
// aufgeben, statt erneut zu fragen und dann auf eine Eingabe zu warten, die
// es nie gibt — stdin ist geschlossen.
const SSH_BASE = '-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o NumberOfPasswordPrompts=1';

/** Zielangabe für rsync, mit abschließendem Schrägstrich: `user@host:pfad/` oder ein lokaler Pfad. */
export function remoteDir(deploy: DeployTarget): string {
  const dir = deploy.path.replace(/\/?$/, '/');
  return deploy.host ? `${deploy.user}@${deploy.host}:${dir}` : dir;
}

/** rsync samt Anmeldeart des Ziels: `flags` vor, `operands` hinter der Verbindungsangabe. Rein, damit prüfbar. */
export function rsyncWith(deploy: DeployTarget, flags: string[], operands: string[]): { command: string; args: string[] } {
  switch (deploy.auth.kind) {
    case 'key':
      // BatchMode: lieber sofort scheitern als auf eine Eingabe warten, die nie kommt.
      return { command: 'rsync', args: [...flags, '-e', `ssh -i ${deploy.auth.keyFile} ${SSH_BASE} -o BatchMode=yes`, ...operands] };
    case 'password':
      // sshpass liest das Passwort aus der Datei, damit es nicht in der
      // Prozessliste steht. BatchMode muss hier fehlen, sonst kein Login.
      return {
        command: 'sshpass',
        args: ['-f', deploy.auth.passwordFile, 'rsync', ...flags, '-e', `ssh ${SSH_BASE} -o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no`, ...operands],
      };
    case 'none':
      return { command: 'rsync', args: [...flags, ...operands] };
  }
}

/**
 * Baut die Kommandozeile für die Übertragung. Rein, damit sie prüfbar ist,
 * ohne rsync zu starten — die Zeile entscheidet über Anmeldung und Zielpfad.
 */
export function rsyncCommand(opts: { distDir: string; deploy: DeployTarget; dryRun?: boolean }): {
  command: string;
  args: string[];
} {
  const { deploy } = opts;
  const remote = remoteDir(deploy);
  const src = opts.distDir.endsWith('/') ? opts.distDir : `${opts.distDir}/`;
  // --no-owner/--no-group/--no-perms/--omit-dir-times: `-a` enthaelt `-ogpt`
  // und laesst rsync versuchen, Besitzer, Gruppe, Rechte und Zeiten am
  // Zielverzeichnis selbst zu setzen.
  // Gehoert es jemand anderem — auf einem Webspace der Regelfall —, bricht der
  // Lauf mit „failed to set permissions on \“…/.\": Operation not permitted" ab.
  // Eine ausgelieferte Webseite braucht nichts davon: Die Dateien bekommen die
  // Vorgaben des Ziels (644 fuer Dateien, 755 fuer Verzeichnisse), und genau
  // die will ein Webserver. Zeiten *der Dateien* und Symlinks bleiben erhalten;
  // nur die Zeitstempel der Verzeichnisse entfallen, und die liest niemand.
  // --itemize-changes nur im Trockenlauf: ohne es schweigt rsync, und der
  // Verbindungstest haette kein Protokoll, aus dem der Zielinhalt hervorgeht.
  // --out-format=%n nur im echten Lauf: eine Zeile je uebertragener Datei, an der
  // die Anzeige mitzaehlt; im Trockenlauf stuende sie neben --itemize-changes.
  // --delete-delay: gelöscht wird erst nach dem Umtausch. `--delete` allein löscht
  // *während* der Übertragung, und ein Abbruch ließe eine Seite mit entfernten,
  // aber noch nicht ersetzten Dateien stehen (B9). Reste `.~tmp~` eines
  // Abbruchs räumt der nächste Lauf.
  // --delay-updates: rsync legt jede Datei erst in einem Zwischenverzeichnis am
  // Ziel ab und tauscht am Ende alle auf einmal um. Ohne das ersetzt es Datei
  // fuer Datei, und ein Abbruch nach der Haelfte laesst eine halb alte, halb
  // neue Seite im Netz stehen.
  const flags = ['-az', '--no-owner', '--no-group', '--no-perms', '--omit-dir-times', '--delete-delay', '--checksum', '--delay-updates', ...(opts.dryRun ? ['--dry-run', '--itemize-changes'] : ['--out-format=%n'])];

  return rsyncWith(deploy, flags, [src, remote]);
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
  signal?: AbortSignal;
  /** Zählt Dateien während der Übertragung (nicht im Trockenlauf). */
  onFile?: (count: number) => void;
}): Promise<{ log: string }> {
  const { command, args } = rsyncCommand(opts);
  const line = `${command} ${args.join(' ')}`;
  console.log(`[site] Uebertragen: ${line}`);
  let files = 0;
  try {
    const { code, log } = await runChild(command, args, {
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      onLine: (out) => {
        const name = out.trim();
        if (!opts.dryRun && name !== '' && !name.endsWith('/') && !name.startsWith('deleting ')) opts.onFile?.(++files);
      },
    });
    if (code !== 0) throw new Error(`${command} exited with ${code}\n${line}\n${log}`);
    return { log: `${line}\n${log}` };
  } catch (error) {
    // Ohne Zeitgrenze wartet ein blockiertes ssh endlos, und der Publish
    // haengt ohne Fehler und ohne Protokoll.
    if (error instanceof ChildTimeoutError) throw new Error(`${command} hat das Zeitlimit ueberschritten\n${line}\n${error.log}`);
    throw error;
  }
}

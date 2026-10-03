/**
 * Was an einem Publish-Ziel schiefgehen kann, so grob, dass die Oberfläche
 * jeweils einen Satz mit Abhilfe dazu hat. Rein, damit das Gesicht der
 * Meldung prüfbar ist, ohne rsync zu starten; die Oberfläche liest es über
 * `@kompass/module-site/client`.
 */
export type DeployProblem = 'authFailed' | 'unreachable' | 'rsyncMissing' | 'targetMissing' | 'notWritable' | 'diskFull' | 'probeLeft' | 'unknown';

/** `stage` ist der Schritt, in dem rsync scheiterte: dieselbe Zeile heißt je nach Stelle etwas anderes. */
export function classifyDeployError(text: string, stage: 'connect' | 'targetDir' | 'writable' | 'transfer'): DeployProblem {
  if (/rsync: (command )?not found|command not found/i.test(text)) return 'rsyncMissing';
  if (/Permission denied \((publickey|password|keyboard)|Permission denied, please try again|Authentication failed|Too many authentication failures/i.test(text)) return 'authFailed';
  if (/Could not resolve|Connection (timed out|refused|reset|closed)|No route to host|Network is unreachable|Zeitlimit|timed out/i.test(text)) return 'unreachable';
  if (/No space left|Disk quota exceeded/i.test(text)) return 'diskFull';
  // Vor „No such file“: openrsync meldet nach einem verweigerten Schreiben noch einen Folgefehler dieser Art.
  if ((stage === 'writable' || stage === 'transfer') && /Permission denied|Read-only file system|Operation not permitted/i.test(text)) return 'notWritable';
  if (stage !== 'connect' && /No such file or directory/i.test(text)) return 'targetMissing';
  return 'unknown';
}

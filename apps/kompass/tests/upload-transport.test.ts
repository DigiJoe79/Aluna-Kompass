import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../src');
const ROOTS = [path.join(SRC, 'app'), path.join(SRC, 'components')];

/**
 * Wächter gegen den Fund N9 (Befundliste 0.2.0): Elf Client-Dateien des
 * Finanzmoduls reichten die Bytes einer hochgeladenen Datei direkt als
 * Argument einer Server Action (`new Uint8Array(await file.arrayBuffer())`
 * inline, oder zwischengespeichert in einer Variablen/einem Feld namens
 * `bytes`). React zählt Typed-Array-Bytes in Server-Action-Argumenten gegen
 * eine interne Grenze (`_arraySizeLimit`) — ab rund 1 MB scheitert der Aufruf
 * mit 500, ohne dass `serverActions.bodySizeLimit` etwas hilft. Der richtige
 * Transport ist `FormData` mit `file` als `File` (Muster: `dms/actions.ts`,
 * `admin/media/actions.ts`) — dort werden die Bytes erst auf dem Server
 * gelesen, wo die Grenze nicht gilt.
 *
 * Der Wächter erkennt jeden Aufruf einer Funktion, deren Name auf `Action`
 * endet, und deren Argumentliste `Uint8Array` oder das Feld `bytes` nennt.
 * `receipt-drop.tsx` liest Bytes nur zur clientseitigen Sichtprüfung
 * (Magic-Bytes) — dort steht kein Aufruf einer Server Action, der Wächter
 * greift also nicht ins Leere.
 */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function isUseClientFile(content: string): boolean {
  const firstLine = content.split('\n').find((line) => line.trim() !== '');
  if (!firstLine) return false;
  return /^['"]use client['"];?$/.test(firstLine.trim());
}

/** Findet jeden `…Action(…)`-Aufruf, dessen (klammerausgeglichene) Argumentliste `Uint8Array` oder das Feld `bytes` nennt. */
function findByteActionCalls(content: string): string[] {
  const found: string[] = [];
  const callRe = /([A-Za-z_$][\w$]*Action)\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(content))) {
    let depth = 1;
    let i = match.index + match[0].length;
    const argsStart = i;
    for (; i < content.length && depth > 0; i++) {
      if (content[i] === '(') depth++;
      else if (content[i] === ')') depth--;
    }
    const args = content.slice(argsStart, i - 1);
    if (/Uint8Array/.test(args) || /\bbytes\b/.test(args)) found.push(match[1]!);
  }
  return found;
}

describe('upload-transport', () => {
  it('Server Actions in Client-Dateien nehmen Datei-Bytes nur über FormData an, nie als Uint8Array-Argument (N9)', () => {
    const files = ROOTS.flatMap(listSourceFiles);
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (!isUseClientFile(content)) continue;
      const calls = findByteActionCalls(content);
      if (calls.length > 0) offenders.push(`${path.relative(SRC, file)}: ${calls.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});

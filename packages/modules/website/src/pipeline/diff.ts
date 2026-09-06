import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';

export async function hashTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(current: string): Promise<void> {
    for (const name of (await readdir(current)).sort()) {
      const full = path.join(current, name);
      // lstat statt stat: ein Verweis auf ein uebergeordnetes Verzeichnis
      // liesse walk() sonst im Kreis laufen, bis das Betriebssystem ELOOP
      // meldet. Verweise werden als Eintrag gezaehlt, nicht verfolgt.
      const info = await lstat(full);
      if (info.isSymbolicLink()) {
        out[path.relative(dir, full).split(path.sep).join('/')] = createHash('sha256').update(`symlink:${await readlink(full)}`).digest('hex');
        continue;
      }
      if (info.isDirectory()) await walk(full);
      else out[path.relative(dir, full).split(path.sep).join('/')] = createHash('sha256').update(await readFile(full)).digest('hex');
    }
  }
  await walk(dir);
  return out;
}

export function diffTrees(previous: Record<string, string>, current: Record<string, string>) {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [file, hash] of Object.entries(current)) {
    if (!(file in previous)) added.push(file);
    else if (previous[file] !== hash) changed.push(file);
  }
  for (const file of Object.keys(previous)) {
    if (!(file in current)) removed.push(file);
  }
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort() };
}

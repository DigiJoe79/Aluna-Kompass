import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../src');
const OWNER = path.join(SRC, 'components/forms/sticky-footer.tsx');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith('.tsx') ? [full] : [];
  });
}

/**
 * Design-Nachtrag Phase 4, Teil C Task 1: Eine Maske hat genau eine klebende
 * Fußleiste, und die kommt aus `StickyFooter`. Wer die Klassen der Leiste von
 * Hand nachbaut, weicht beim nächsten Umbau ab.
 */
describe('klebende Fußleiste nur aus dem gemeinsamen Baustein', () => {
  it('keine Datei außer sticky-footer.tsx baut die Leiste mit eigenen Klassen nach', () => {
    const copies = tsxFiles(SRC)
      .filter((file) => file !== OWNER)
      .filter((file) => readFileSync(file, 'utf8').includes('sticky bottom-0 z-10 space-y-2 rounded-md border'))
      .map((file) => path.relative(SRC, file));
    expect(copies).toEqual([]);
  });
});

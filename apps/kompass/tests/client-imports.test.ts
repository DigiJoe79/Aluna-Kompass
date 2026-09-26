import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../src');

/**
 * Wächter gegen den Client-Bundling-Fund aus N3 Lauf 4 (Design-Nachtrag,
 * Nachtrag B): Ein Wert-Import (nicht `import type`) aus `@kompass/core`
 * oder `@kompass/module-*` in einer `'use client'`-Datei zieht den
 * Server-Graphen (`@node-rs/argon2`, Drizzle, Dateisystem …) ins
 * Client-Bündel — die Route scheitert dann still mit
 * `ENOENT …/build-manifest.json` (gefunden bei `machine-panel.tsx`,
 * F6a Lauf 4ec9a68, behoben mit `FACSIMILE_MAX_BYTES` als Prop). Erlaubt
 * sind `import type` und die eigens dafür browsertauglichen Unterpfade, die
 * kein `@kompass/core` und keine Datenbank ziehen (Header-Kommentar je
 * Unterpfad-Datei).
 */
const ALLOWED_VALUE_SUBPATHS = new Set([
  '@kompass/module-finance/csv',
  '@kompass/module-finance/wording',
  '@kompass/module-site/client',
  '@kompass/module-contacts/address',
  '@kompass/core/themes',
]);

/** Datei → Modul, mit Begründung, warum ein Wert-Import dort ausnahmsweise unbedenklich ist. */
const EXCEPTIONS: Record<string, string> = {};

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

interface Violation {
  file: string;
  moduleSpecifier: string;
  clause: string;
}

function findViolations(file: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const importRe = /import\s+(type\s+)?([^;]*?)\s+from\s+['"](@kompass\/[^'"]+)['"];?/g;
  for (const match of content.matchAll(importRe)) {
    const [, wholeTypeOnly, clause, moduleSpecifier] = match;
    if (wholeTypeOnly) continue; // `import type { … } from '@kompass/…'`
    if (ALLOWED_VALUE_SUBPATHS.has(moduleSpecifier!)) continue;

    const trimmedClause = clause!.trim();
    if (trimmedClause.startsWith('{') && trimmedClause.endsWith('}')) {
      const bindings = trimmedClause
        .slice(1, -1)
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean);
      const allTypeOnly = bindings.every((b) => b.startsWith('type '));
      if (allTypeOnly) continue;
    }

    violations.push({ file, moduleSpecifier: moduleSpecifier!, clause: trimmedClause });
  }
  return violations;
}

describe('client-imports', () => {
  it("eine 'use client'-Datei importiert aus @kompass/* nur Typen oder browsertaugliche Unterpfade", () => {
    const files = listSourceFiles(SRC);
    const found: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (!isUseClientFile(content)) continue;
      const relative = path.relative(SRC, file);
      for (const violation of findViolations(file, content)) {
        const reason = EXCEPTIONS[`${relative}:${violation.moduleSpecifier}`];
        if (reason) continue;
        found.push(`${relative}: Wert-Import "${violation.clause}" aus "${violation.moduleSpecifier}"`);
      }
    }
    expect(found).toEqual([]);
  });
});

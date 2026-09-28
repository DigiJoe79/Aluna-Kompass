import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Wer Rollen, Rechte oder Konten schreibt, muss fragen, ob der Aufrufer das
 * darf (`src/roles/privileges.ts`). Vier Wege zur Rechteausweitung gab es, weil
 * jede dieser Funktionen nur das Grundrecht prüfte (Release-Prüfung S7). Ohne
 * Wächter fehlt die Frage beim fünften Weg, den jemand in einem halben Jahr baut.
 */

const WRITES = /\.(insert|delete|update)\((userRoles|rolePermissions|users)\)/;
const CHECKS = /requireGrantableRole|requireGrantablePermissions|requireControllableUser/;

/** Schreibt, ohne dass ein Aufrufer mehr Rechte bekommen oder über ein fremdes Konto verfügen könnte. */
const EXEMPT: Record<string, string> = {
  'auth/login.ts:login': 'Fehlversuche und Sperre am eigenen Konto',
  'auth/login.ts:changeOwnPassword': 'nur das eigene Passwort',
  'setup/service.ts:completeSetup': 'das erste Konto; es gibt noch niemanden, dessen Rechte man übersteigen könnte',
  'seed/seed.ts:seedDevelopment': 'Entwicklungsdaten, läuft nie in Produktion',
  'roles/provision.ts:createRoleInternal': 'Grundausstattung eines Moduls; legt Rollenvorschläge an, weist keine Rollen zu',
};

interface Write {
  file: string;
  fn: string;
  checked: boolean;
}

function findWrites(file: string, source: string): Write[] {
  const lines = source.split('\n');
  const found = new Map<string, Write>();
  lines.forEach((line, index) => {
    if (!WRITES.test(line)) return;
    let start = index;
    while (start >= 0 && !/^(export )?(async )?function \w+/.test(lines[start]!)) start -= 1;
    const fn = start >= 0 ? /function (\w+)/.exec(lines[start]!)![1]! : '<modul>';
    let end = index;
    while (end < lines.length && lines[end] !== '}') end += 1;
    const body = lines.slice(Math.max(start, 0), end + 1).join('\n');
    found.set(`${file}:${fn}`, { file, fn, checked: CHECKS.test(body) });
  });
  return [...found.values()];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'testing' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('Wächter gegen Rechteausweitung', () => {
  it('erkennt eine Schreibstelle ohne Prüfung', () => {
    const source = [
      'export async function grantQuietly(deps, ctx, input) {',
      '  deps.db.insert(userRoles).values(input).run();',
      '}',
      'export async function grantProperly(deps, ctx, input) {',
      '  const escalation = requireGrantableRole(deps, ctx, input.roleId);',
      '  deps.db.insert(userRoles).values(input).run();',
      '}',
    ].join('\n');
    expect(findWrites('x.ts', source)).toEqual([
      { file: 'x.ts', fn: 'grantQuietly', checked: false },
      { file: 'x.ts', fn: 'grantProperly', checked: true },
    ]);
  });

  it('jede Funktion, die Rollen, Rechte oder Konten schreibt, prüft die eigenen Rechte des Aufrufers', () => {
    const root = path.resolve(import.meta.dirname, '../src');
    const writes = sourceFiles(root).flatMap((full) => findWrites(path.relative(root, full), readFileSync(full, 'utf8')));
    const unchecked = writes.filter((w) => !w.checked && !(`${w.file}:${w.fn}` in EXEMPT)).map((w) => `${w.file}:${w.fn}`);
    expect(unchecked).toEqual([]);
    const seen = new Set(writes.map((w) => `${w.file}:${w.fn}`));
    expect(Object.keys(EXEMPT).filter((key) => !seen.has(key))).toEqual([]);
  });
});

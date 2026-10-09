import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(import.meta.dirname, '../../../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return ['node_modules', 'tests', 'dist', '.next'].includes(name) ? [] : sources(full);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

/** Datei → Grund. Anfangs leer: Die Tier-`summary` (Kurztext eines Hundes) steht nie neben einem `action:`. */
const ALLOWED: Record<string, string> = {};

/** Ein `summary:` in einem Objekt, das auch `action:` trägt — in derselben Zeile oder den fünf davor. */
function auditSummaries(source: string): number[] {
  const lines = source.split('\n');
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (!/\bsummary:/.test(line)) return;
    const window = lines.slice(Math.max(0, i - 5), i + 1).join('\n');
    if (/\baction:/.test(window)) hits.push(i + 1);
  });
  return hits;
}

/**
 * Spec Protokoll § 6, Wächter 3: Das Protokoll speichert Werte (`params`), nie einen fertigen Satz. `summary` als
 * Protokollfeld kommt in den Quellen nicht mehr vor.
 */
describe('kein gespeicherter Satz im Protokoll', () => {
  it('kein summary neben action in packages/*/src und apps/kompass/src', () => {
    const roots = [path.join(REPO, 'packages'), path.join(REPO, 'apps/kompass/src')];
    const offenders = roots
      .flatMap(sources)
      .filter((file) => file.includes(`${path.sep}src${path.sep}`))
      .flatMap((file) => auditSummaries(readFileSync(file, 'utf8')).map((line) => `${path.relative(REPO, file)}:${line}`))
      .filter((hit) => !(hit.split(':')[0]! in ALLOWED));
    expect(offenders).toEqual([]);
  });

  it('findet eine Probezeile', () => {
    expect(auditSummaries("recordAudit(tx, deps, ctx, {\n  action: 'a.b',\n  entityType: 'x',\n  summary: `x`,\n});")).toEqual([4]);
    expect(auditSummaries("const animal = { name: 'Bello', summary: { de: 'Kurz' } };")).toEqual([]);
  });
});

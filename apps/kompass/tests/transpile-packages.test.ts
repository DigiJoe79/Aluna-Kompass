import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = path.resolve(import.meta.dirname, '..');

/**
 * Jedes Workspace-Paket, das die App als TypeScript-Quelle einbindet, steht in
 * `transpilePackages` — sonst verlässt sich der Bau darauf, dass es zufällig
 * mitübersetzt wird (Befundliste 0.2.0: `module-projects` fehlte). Ausnahmen
 * nur mit Grund.
 */
const EXCEPTIONS: Record<string, string> = {
  '@kompass/site-template': 'von der App nie importiert; die Vorlage baut Astro, nicht Next',
};

describe('transpilePackages', () => {
  it('nennt jede @kompass-Abhängigkeit der App', () => {
    const pkg = JSON.parse(readFileSync(path.join(APP, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    const config = readFileSync(path.join(APP, 'next.config.ts'), 'utf8');
    const start = config.indexOf('transpilePackages');
    const block = config.slice(start, config.indexOf(']', start));
    const listed = new Set([...block.matchAll(/'(@kompass\/[^']+)'/g)].map((m) => m[1]));
    const missing = Object.keys(pkg.dependencies)
      .filter((name) => name.startsWith('@kompass/') && !(name in EXCEPTIONS))
      .filter((name) => !listed.has(name));
    expect(missing).toEqual([]);
  });
});

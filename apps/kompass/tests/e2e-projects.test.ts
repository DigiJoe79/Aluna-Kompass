import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installedModuleKeys, scopeFromPaths, specProject, testMatchFor } from '../e2e/projects';

const ROOT = path.resolve(import.meta.dirname, '..');
const modules = installedModuleKeys(ROOT);
const specs = readdirSync(path.join(ROOT, 'e2e')).filter((name) => name.endsWith('.spec.ts'));

describe('installedModuleKeys', () => {
  it('liest die Module aus packages/modules', () => {
    expect(modules).toEqual(['animals', 'contacts', 'dms', 'finance', 'projects', 'site']);
  });
});

describe('specProject', () => {
  it('ordnet eine Spec über ihren Präfix dem Modul zu', () => {
    expect(specProject('finance.spec.ts', modules)).toBe('finance');
    expect(specProject('finance-cash.spec.ts', modules)).toBe('finance');
    expect(specProject('site-publish.spec.ts', modules)).toBe('site');
    expect(specProject('dms.spec.ts', modules)).toBe('dms');
    expect(specProject('animals.spec.ts', modules)).toBe('animals');
  });

  it('kennt Ausnahmen, deren Name nicht der Modulschlüssel ist', () => {
    // `fields.spec.ts` prüft die Zusatzfelder der Akte.
    expect(specProject('fields.spec.ts', modules)).toBe('dms');
  });

  it('gibt alles Übrige dem Kern', () => {
    expect(specProject('auth.spec.ts', modules)).toBe('kern');
    expect(specProject('shell.spec.ts', modules)).toBe('kern');
  });

  /**
   * Wächter: Jede Spec gehört bewusst irgendwohin. Eine neue Datei, die hier
   * im Kern landet, ohne dass jemand sie hier einträgt, lässt den Test rot
   * werden — dann heisst sie entweder nach ihrem Modul oder steht ab jetzt
   * ausdrücklich beim Kern.
   */
  it('der Kern ist genau die Liste, die hier steht', () => {
    const kern = specs.filter((file) => specProject(file, modules) === 'kern').sort();
    expect(kern).toEqual([
      'audit.spec.ts',
      'auth.spec.ts',
      'backup.spec.ts',
      'documents.spec.ts',
      'follow-ups.spec.ts',
      'health.spec.ts',
      'help.spec.ts',
      'home.spec.ts',
      'hydration.spec.ts',
      'instrumentation.spec.ts',
      'locales.spec.ts',
      'mcp.spec.ts',
      'media.spec.ts',
      'module-inactive.spec.ts',
      'modules.spec.ts',
      'palette-and-errors.spec.ts',
      'profile.spec.ts',
      'roles.spec.ts',
      'security-headers.spec.ts',
      'settings.spec.ts',
      'setup-import.spec.ts',
      'shell.spec.ts',
      'theme.spec.ts',
      'themes.spec.ts',
      'users.spec.ts',
      'version.spec.ts',
    ]);
  });

  it('jede Spec landet in genau einem Projekt, und jedes Modul hat mindestens eine', () => {
    const byProject = new Map<string, string[]>();
    for (const file of specs) {
      const project = byProject.get(specProject(file, modules)) ?? [];
      project.push(file);
      byProject.set(specProject(file, modules), project);
    }
    for (const key of modules) expect(byProject.get(key)?.length, key).toBeGreaterThan(0);
    const total = [...byProject.values()].reduce((sum, files) => sum + files.length, 0);
    expect(total).toBe(specs.length);
  });
});

describe('testMatchFor', () => {
  it('liefert je Projekt die Dateien als Muster, zusammen alle', () => {
    const all = ['kern', ...modules].flatMap((project) => testMatchFor(project, specs, modules));
    expect(all.length).toBe(specs.length);
    expect(testMatchFor('finance', specs, modules)).toContain('**/finance-cash.spec.ts');
    expect(testMatchFor('finance', specs, modules)).not.toContain('**/dms.spec.ts');
  });
});

describe('scopeFromPaths', () => {
  it('bildet aus Änderungen an einem Modul dessen Umfang', () => {
    expect(
      scopeFromPaths(
        [
          'packages/modules/finance/src/ledger/entries.ts',
          'apps/kompass/src/app/(shell)/finance/entries/page.tsx',
          'apps/kompass/src/lib/finance/remedies.ts',
          'apps/kompass/src/components/finance/amount.tsx',
          'apps/kompass/e2e/finance-cash.spec.ts',
          'packages/modules/finance/tests/entries.test.ts',
        ],
        modules,
      ),
    ).toEqual({ kind: 'modules', modules: ['finance'] });
  });

  it('nimmt mehrere Module zusammen', () => {
    expect(scopeFromPaths(['packages/modules/dms/src/x.ts', 'apps/kompass/e2e/site-publish.spec.ts'], modules)).toEqual({
      kind: 'modules',
      modules: ['dms', 'site'],
    });
  });

  it('fällt auf die volle Suite zurück, wenn Geteiltes betroffen ist', () => {
    for (const shared of [
      'packages/core/src/app.ts',
      'packages/documents/src/render.ts',
      'apps/kompass/src/components/forms/action-form.tsx',
      'apps/kompass/src/lib/deps.ts',
      'apps/kompass/src/app/(shell)/layout.tsx',
      'apps/kompass/e2e/fixtures.ts',
      'apps/kompass/e2e/helpers.ts',
      'apps/kompass/playwright.config.ts',
      'apps/kompass/next.config.ts',
      'package.json',
      'pnpm-lock.yaml',
      'Dockerfile',
      'templates/verein-basis/src/pages/index.astro',
      'scripts/docker-entrypoint.sh',
    ]) {
      expect(scopeFromPaths([shared], modules), shared).toEqual({ kind: 'full' });
    }
  });

  it('eine geteilte Datei schlägt jedes Modul', () => {
    expect(scopeFromPaths(['packages/modules/finance/src/x.ts', 'packages/core/src/y.ts'], modules)).toEqual({ kind: 'full' });
  });

  it('Handbuch und App-Tests brauchen App-Tests und Kern, aber kein Modulprojekt', () => {
    expect(scopeFromPaths(['docs/handbuch/finanzen/journal.md', 'apps/kompass/tests/handbook-complete.test.ts'], modules)).toEqual({
      kind: 'modules',
      modules: [],
    });
  });

  it('Arbeitsdokumente lösen nichts aus', () => {
    expect(scopeFromPaths(['CHANGELOG.md', 'AGENTS.md', 'docs/intern/specs/x.md', '.github/workflows/ci.yml', 'docs/nordstern.md'], modules)).toEqual({
      kind: 'none',
    });
  });
});

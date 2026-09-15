import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

/**
 * AGENTS.md verlangt für jedes Modul Entwicklungsdaten: „Ein neues Modul
 * bringt einen `seed`-Haken im Manifest mit … und ein Test wie
 * `…/tests/seed.test.ts`."
 *
 * Die Regel stand seit Monaten da, und `site` hatte trotzdem keinen — nach
 * `pnpm seed` waren Kontakte, Akte, Tiere und Projekte gefüllt, die Webseite
 * leer. Aufgefallen ist das erst bei der Durchsicht vor dem Release (F5).
 * Eine Regel, die niemand prüft, gilt für das nächste Modul genauso wenig.
 */
describe('Jedes Modul bringt Entwicklungsdaten mit', () => {
  it('hat einen seed-Haken im Manifest', () => {
    const ohne = installedModules.filter((m) => !m.seed).map((m) => m.key);
    expect(ohne).toEqual([]);
  });

  /**
   * Der Haken allein sagt nicht, dass er tut, was er soll. Geprüft wird die
   * Existenz eines Tests, nicht sein Inhalt — was er prüft, steht in ihm.
   * `site` nennt seinen `dev-seed.test.ts`, weil `seed.test.ts` dort den
   * Startinhalt aus dem Template prüft (Spec 2026-09-08).
   */
  it('prüft diese Daten in einem eigenen Test', () => {
    const wurzel = path.resolve(import.meta.dirname, '../../../packages/modules');
    const ohneTest = installedModules.filter((m) => {
      const tests = path.join(wurzel, m.key, 'tests');
      return !['seed.test.ts', 'dev-seed.test.ts'].some((name) => existsSync(path.join(tests, name)));
    });
    expect(ohneTest.map((m) => m.key)).toEqual([]);
  });
});

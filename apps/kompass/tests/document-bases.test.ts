import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

/**
 * Befund 51 b: Kompass meldet eine genutzte Basis, die die Installation nicht
 * selbst führt — aber nur, wenn das Modul sie in `documentBases` nennt. Jede
 * Basis, auf der eine Vorlage des Moduls erscheint, muss deshalb dort stehen.
 */
describe('documentBases der installierten Module', () => {
  it('nennt jede Basis, die eine Vorlage des Moduls nutzt', () => {
    const missing = installedModules.flatMap((manifest) =>
      (manifest.documentTemplates ?? [])
        .filter((template) => !(manifest.documentBases ?? []).includes(template.base))
        .map((template) => `${manifest.key}: ${template.key} → ${template.base}`),
    );
    expect(missing).toEqual([]);
    expect(installedModules.find((m) => m.key === 'finance')?.documentBases).toContain('a4-formular');
  });
});

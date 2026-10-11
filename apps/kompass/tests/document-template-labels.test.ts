import { coreModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';
import messages from '../messages/de.json';

/**
 * Stufe 1, Auftrag 6: Jede Dokumentvorlage hat eine Beschriftung in `documents.create.templates` — sonst zeigte die
 * Einrichtung den Schlüssel (`animals-profile`). Fehlt sie doch, steht „—“, nie der Schlüssel.
 */
const labels = (messages as unknown as { documents: { create: { templates: Record<string, string> } } }).documents.create.templates;

describe('Beschriftung der Dokumentvorlagen', () => {
  it('jede Vorlage aus Kern und Modulen steht in documents.create.templates', () => {
    const keys = [coreModule, ...installedModules].flatMap((manifest) => (manifest.documentTemplates ?? []).map((template) => template.key));
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((key) => !labels[key])).toEqual([]);
  });
});

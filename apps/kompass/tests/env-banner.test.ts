import { describe, expect, it } from 'vitest';
import { bannerFor } from '@/lib/env-banner';

describe('bannerFor', () => {
  it('is absent in production', () => {
    expect(bannerFor('production', { lastImportAt: null, migrationCount: 3 })).toBeNull();
  });
  /**
   * Nur die Art, keine Beschriftung: Der sichtbare Text kam bis zum
   * 2026-09-15 als Literal von hier und ist seitdem in `messages/de.json`.
   * Die Komponente schlägt ihn über `kind` nach.
   */
  it('names the kind of environment, not its label', () => {
    expect(bannerFor('test', { lastImportAt: '2026-09-02T09:00:00.000Z', migrationCount: 3 })).toEqual({ kind: 'test' });
    expect(bannerFor('development', { lastImportAt: null, migrationCount: 3 })).toEqual({ kind: 'development' });
  });
});

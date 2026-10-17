import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@kompass/core';
import { BANNER_COLORS } from '@/components/shell/env-banner';
import { bannerFor, titleKeyFor } from '@/lib/env-banner';

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

/**
 * Seitentitel je Umgebung (Joe 2026-10-11): Prod und Test laufen auf demselben NAS, Safari blendet den Port aus —
 * Tab und Kachel müssen sagen, welche Instanz es ist. Prod heißt wie das Produkt, Test und Dev tragen die Art.
 */
describe('titleKeyFor', () => {
  it('nennt in Produktion den Produktnamen, sonst die Art der Instanz', () => {
    expect(titleKeyFor('production')).toBe('app.name');
    expect(titleKeyFor('test')).toBe('app.titleTest');
    expect(titleKeyFor('development')).toBe('app.titleDevelopment');
  });
});

/**
 * Farben je Umgebung (Designer 2026-10-16, Teil 3 Nr. 15): Test (Echtdaten) Ocker mit Schraffur, Entwicklung neutrales
 * Dunkelgrau, Produktion ohne Balken. Rot steht auf keinem Balken; die Schrift hat ≥ 4,5:1 zur Fläche.
 */
describe('Farben des Umgebungsbalkens', () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const isRed = (hex: string) => {
    const [r, g, b] = rgb(hex);
    return r > 1.6 * g && r > 1.6 * b;
  };
  const isGray = (hex: string) => {
    const [r, g, b] = rgb(hex);
    return Math.max(r, g, b) - Math.min(r, g, b) <= 12 && Math.max(r, g, b) < 96;
  };

  it('Test ist Ocker mit Schraffur, Entwicklung Dunkelgrau ohne', () => {
    const [r, g, b] = rgb(BANNER_COLORS.test.bg);
    expect(r > g && g > b && b < 80).toBe(true);
    expect(BANNER_COLORS.test.hatch).not.toBeNull();
    expect(isGray(BANNER_COLORS.development.bg)).toBe(true);
    expect(BANNER_COLORS.development.hatch).toBeNull();
  });

  it('kein Rot und Schrift ≥ 4,5:1', () => {
    for (const c of Object.values(BANNER_COLORS)) {
      expect(isRed(c.bg)).toBe(false);
      if (c.hatch) expect(isRed(c.hatch)).toBe(false);
      expect(contrastRatio(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

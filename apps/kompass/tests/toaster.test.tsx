// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TOAST_CLASSES, toastBottomOffset } from '@/components/ui/sonner';

/**
 * Toast wie Notice (Designer 2026-10-16, Teil 3 Nr. 11, 12): Vollrahmen mit denselben Tönen, keine blaue
 * Info-Variante — Info ist neutral. Kein Layout-Test der Lage (Einzelstelle); geprüft wird die Konfiguration.
 */
describe('Toaster', () => {
  it('kennt keine Info-Variante und keinen Linksbalken', () => {
    expect(Object.keys(TOAST_CLASSES)).not.toContain('info');
    expect(JSON.stringify(TOAST_CLASSES)).not.toMatch(/info|border-l/);
  });

  it('Töne wie Notice: Vollrahmen und Fläche', () => {
    expect(TOAST_CLASSES.error).toContain('border-error');
    expect(TOAST_CLASSES.error).toContain('bg-error-bg');
    expect(TOAST_CLASSES.warning).toContain('border-warning');
    expect(TOAST_CLASSES.warning).toContain('bg-warning-bg');
    expect(TOAST_CLASSES.success).toContain('border-success');
    expect(TOAST_CLASSES.success).toContain('bg-success-bg');
  });

  it('steht über einer klebenden Leiste: Leistenhöhe + 16 px, sonst die Vorgabe', () => {
    expect(toastBottomOffset(0)).toBeUndefined();
    expect(toastBottomOffset(61)).toBe(77);
  });
});

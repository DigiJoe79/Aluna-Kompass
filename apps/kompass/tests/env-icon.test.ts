import { describe, expect, it } from 'vitest';
import { ICON_COLORS, iconSvg } from '@/lib/env-icon';

/**
 * Browser-Icon „Nadel“ (Designer 2026-10-11, `design_handoff_icon/HANDOFF.md`): Form und weiße Nordhälfte bleiben,
 * die Grundfarbe wechselt je Umgebung, damit Prod und Test auf demselben NAS im Tab und in Safari unterscheidbar sind.
 */
describe('Browser-Icon je Umgebung', () => {
  it('nimmt die Farben aus dem Handoff', () => {
    expect(ICON_COLORS.production).toEqual({ ground: '#2F5D68', south: '#D98B6A' });
    expect(ICON_COLORS.test).toEqual({ ground: '#8A5A05', south: '#191C1F' });
    expect(ICON_COLORS.development).toEqual({ ground: '#5B4A86', south: '#D98B6A' });
  });

  it('zeichnet Grund, Nord und Süd in der Geometrie des Handoffs', () => {
    const svg = iconSvg('test');
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain('<rect width="32" height="32" rx="7" fill="#8A5A05"/>');
    expect(svg).toContain('<path fill="#FFFFFF" d="M25 7 18.8 18.8 13.2 13.2Z"/>');
    expect(svg).toContain('<path fill="#191C1F" d="M7 25 13.2 13.2 18.8 18.8Z"/>');
  });
});

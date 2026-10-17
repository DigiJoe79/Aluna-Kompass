// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Overline } from '@/components/overline';

/**
 * In Dialogen stehen über Feldern und Gruppen normale Feldbezeichnungen, keine Kapitälchen (Designer Runde 3: 148, 157,
 * 195, 210). `Overline field` hat die Rolle einer Feldbezeichnung (13/600, keine Versalien).
 */
afterEach(cleanup);

describe('Overline field', () => {
  it('ohne `field` bleibt das Etikett in Versalien', () => {
    const { container } = render(<Overline>Format</Overline>);
    expect(container.firstElementChild!.className).toContain('uppercase');
  });

  it('mit `field` steht es wie eine Feldbezeichnung', () => {
    const { container } = render(<Overline field>Format</Overline>);
    const cls = container.firstElementChild!.className;
    expect(cls).not.toContain('uppercase');
    expect(cls).toContain('text-meta');
    expect(cls).toContain('font-semibold');
  });
});

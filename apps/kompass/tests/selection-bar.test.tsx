import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SelectionBar } from '@/components/selection-bar';

describe('SelectionBar', () => {
  it('ohne Auswahl: nur die leere Live-Region, keine Leiste', () => {
    const markup = renderToStaticMarkup(<SelectionBar count={0} label="">x</SelectionBar>);
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('data-testid="selection-bar"');
  });
  it('mit Auswahl: Live-Region mit Text, sichtbare Leiste mit Knöpfen, klebt unten', () => {
    const markup = renderToStaticMarkup(<SelectionBar count={3} label="3 ausgewählt"><button>Verschieben</button></SelectionBar>);
    expect(markup).toMatch(/role="status"[^>]*>3 ausgewählt</);
    expect(markup).toContain('data-testid="selection-bar"');
    expect(markup).toContain('sticky bottom-0');
    expect(markup).toContain('Verschieben');
  });
  it('bricht auf dem Telefon in Spalten um', () => {
    const markup = renderToStaticMarkup(<SelectionBar count={1} label="1 ausgewählt"><button>A</button></SelectionBar>);
    expect(markup).toContain('max-sm:flex-col');
  });
});

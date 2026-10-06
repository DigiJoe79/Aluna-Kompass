import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PanelNav, panelFromQuery, panelHref } from '@/components/panel-nav';

const PANELS = ['a', 'b', 'c'] as const;
const labels = { a: 'Erster', b: 'Zweiter', c: 'Dritter' };

describe('panelFromQuery', () => {
  it('nimmt einen bekannten Bereich', () => expect(panelFromQuery('b', PANELS, 'a')).toBe('b'));
  it('fällt bei unbekanntem oder fehlendem Wert auf den ersten Bereich zurück', () => {
    expect(panelFromQuery('quatsch', PANELS, 'a')).toBe('a');
    expect(panelFromQuery(undefined, PANELS, 'a')).toBe('a');
    expect(panelFromQuery('', PANELS, 'a')).toBe('a');
  });
});

describe('panelHref', () => {
  it('setzt den Bereich als Query-Parameter', () => expect(panelHref('/admin/dms', 'rules')).toBe('/admin/dms?panel=rules'));
});

describe('PanelNav', () => {
  const html = (invalid?: ReadonlySet<'a' | 'b' | 'c'>) =>
    renderToStaticMarkup(<PanelNav basePath="/x" panels={PANELS} active="b" labels={labels} invalid={invalid} invalidLabel="Enthält Fehler" ariaLabel="Bereiche" />);

  it('ist eine benannte Navigation mit einem Link je Bereich', () => {
    const markup = html();
    expect(markup).toContain('<nav');
    expect(markup).toContain('aria-label="Bereiche"');
    expect(markup.match(/<a\b/g)?.length).toBe(3);
    expect(markup).toContain('href="/x?panel=c"');
  });

  it('markiert nur den aktiven Bereich mit aria-current', () => {
    const markup = html();
    expect(markup.match(/aria-current="page"/g)?.length).toBe(1);
    expect(markup).toMatch(/aria-current="page"[^>]*>Zweiter|>Zweiter<[^]*?aria-current/);
  });

  it('zeigt den Fehlerpunkt nur an ungültigen Bereichen, mit Text für Vorleser', () => {
    const markup = html(new Set(['a']));
    expect(markup.match(/data-invalid="true"/g)?.length).toBe(1);
    expect(markup).toContain('aria-label="Enthält Fehler"');
  });
});

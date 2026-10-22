import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RowButton, RowLink, Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

describe('ui/table Standard', () => {
  it('RowLink ist ein echter Link mit Fläche über die Zeile', () => {
    const m = renderToStaticMarkup(
      <Table><TableBody><TableRow><TableCell><RowLink href="/x/1">Bello</RowLink></TableCell></TableRow></TableBody></Table>,
    );
    expect(m).toMatch(/<tr[^>]*relative/);
    expect(m).toMatch(/<a[^>]*href="\/x\/1"[^>]*data-row-link|<a[^>]*data-row-link[^>]*href="\/x\/1"/);
    expect(m).toMatch(/<a[^>]*after:absolute[^>]*after:inset-0|<a[^>]*after:inset-0[^>]*after:absolute/);
  });
  it('RowButton ist ein Knopf mit derselben Fläche', () => {
    const m = renderToStaticMarkup(<RowButton aria-expanded={false}>Mehr</RowButton>);
    expect(m).toMatch(/<button[^>]*type="button"/);
    expect(m).toContain('after:inset-0');
  });
  it('Zellen heben Bedienelemente über die Fläche, nicht aber den RowLink selbst', () => {
    const m = renderToStaticMarkup(<TableCell>x</TableCell>);
    expect(m).toContain(':not([data-row-link])');
    expect(m).toContain('z-10');
  });
  it('selectable hebt die ganze Zelle über die Fläche', () => {
    expect(renderToStaticMarkup(<TableCell selectable>DE12…</TableCell>)).toMatch(/relative[^"]*z-10|z-10[^"]*relative/);
  });
});

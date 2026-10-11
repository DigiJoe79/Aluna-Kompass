import { Globe } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from '@/components/status-badge';

describe('StatusBadge', () => {
  it('zeigt ein Symbol vor dem Text, für Vorleser verborgen', () => {
    const markup = renderToStaticMarkup(<StatusBadge tone="neutral" icon={Globe}>Produktion</StatusBadge>);
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>.*<\/svg>Produktion/);
    expect(markup).toContain('size-3');
  });
  it('hat Radius 4 und 12/600 wie jede Marke', () => {
    const markup = renderToStaticMarkup(<StatusBadge tone="agent">MCP</StatusBadge>);
    expect(markup).toContain('rounded-sm');
    expect(markup).toContain('text-hint font-semibold'); // 12 px über die Rolle (K10 Charge 3)
  });
});

describe('StatusBadge testId', () => {
  it('setzt data-testid am span', () => {
    expect(renderToStaticMarkup(<StatusBadge tone="neutral" testId="y">x</StatusBadge>)).toMatch(/^<span[^>]*data-testid="y"/);
  });
});

/** Stempel auf der Wischkarte (Designer § 14): auf dem Foto trägt die normale Marke nicht. */
describe('StatusBadge stamp', () => {
  it('setzt 15/600, mehr Polster, Rahmen 2 px in der Tonfarbe und Schatten', () => {
    const markup = renderToStaticMarkup(<StatusBadge tone="info" stamp>Prüfen</StatusBadge>);
    for (const cls of ['text-section', 'font-semibold', 'px-3', 'py-1.5', 'rounded-md', 'border-2', 'border-current', 'shadow-sm', 'bg-info-bg', 'text-info']) {
      expect(markup).toContain(cls);
    }
    expect(markup).not.toContain('text-hint');
    expect(markup).not.toContain('rounded-sm');
  });
});

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
    expect(markup).toContain('text-[12px] font-semibold');
  });
});

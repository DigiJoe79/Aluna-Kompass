import { Globe } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from '@/components/status-badge';

describe('StatusBadge', () => {
  it('zeigt ein Symbol vor dem Text, für Vorleser verborgen', () => {
    const markup = renderToStaticMarkup(<StatusBadge tone="neutral" icon={Globe}>Produktion</StatusBadge>);
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>.*<\/svg>Produktion/);
  });
});

describe('StatusBadge testId', () => {
  it('setzt data-testid am span', () => {
    expect(renderToStaticMarkup(<StatusBadge tone="neutral" testId="y">x</StatusBadge>)).toMatch(/^<span[^>]*data-testid="y"/);
  });
});

describe('Gremien in STATUS_TONES (N6)', () => {
  it('festgeschrieben is the normal state of a meeting in lists; a Zwischenverfügung is an error', async () => {
    const { isNormalInList, statusTone } = await import('@/components/status-badge');
    expect(isNormalInList('meeting', 'signed')).toBe(true);
    expect(isNormalInList('meeting', 'recorded')).toBe(false);
    expect(statusTone('registration', 'interimOrder')).toBe('error');
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';

afterEach(cleanup);

describe('PageHeader status', () => {
  it('die Marke steht direkt nach dem h1, nicht darin (Spec Seitenkopf § 3.4)', () => {
    render(<PageHeader title="Partner X" status={<StatusBadge tone="neutral">archiviert</StatusBadge>} />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('Partner X');
    expect(h1.nextElementSibling?.textContent).toBe('archiviert');
  });
});

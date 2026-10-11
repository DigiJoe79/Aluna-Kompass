// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { UsageLines } from '@/app/(shell)/admin/media/usage-lines';

vi.mock('next/link', () => ({ default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));

afterEach(cleanup);

const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{ui}</NextIntlClientProvider>);
const refs = [
  { label: 'Team: Mira', href: '/site/c/team/e1', cropped: true as const },
  { label: 'Projekt: Ost', href: '/projects/p1' },
];

/** Handover alle Bilder 4, Board 3a: Verwendungen untereinander, „· zugeschnitten“ gedämpft, kein Bearbeiten. */
describe('UsageLines', () => {
  it('eine Zeile je Verwendung, „· zugeschnitten“ hinter dem Label', () => {
    const { container } = wrap(<UsageLines references={refs} />);
    const lines = container.querySelectorAll('li');
    expect(Array.from(lines).map((l) => l.textContent)).toEqual(['Team: Mira · zugeschnitten', 'Projekt: Ost']);
    expect(screen.getByText('· zugeschnitten').className).toContain('text-muted-ink');
  });

  it('verlinkt im Detail zur Stelle; ohne Verwendung „nicht verwendet“', () => {
    wrap(<UsageLines references={refs} linked />);
    expect(screen.getByRole('link', { name: 'Team: Mira' }).getAttribute('href')).toBe('/site/c/team/e1');
    cleanup();
    wrap(<UsageLines references={[]} />);
    expect(screen.getByText('nicht verwendet')).toBeTruthy();
  });
});

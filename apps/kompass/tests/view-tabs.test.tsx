// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ViewTabs } from '@/components/view-tabs';

afterEach(cleanup);

const tabs = [
  { key: 'all', label: 'Alle', href: '/animals', count: 6 },
  { key: 'review', label: 'Prüfung offen', href: '/animals?view=review', count: 0, testId: 'tab-review' },
  { key: 'none', label: 'Ohne Zahl', href: '/animals?view=none' },
];

describe('ViewTabs', () => {
  it('ist eine benannte Navigation aus Links, der aktuelle trägt aria-current="page", kein role="tab"', () => {
    render(<ViewTabs label="Ansichten" tabs={tabs} current="all" />);
    const nav = screen.getByRole('navigation', { name: 'Ansichten' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/animals', '/animals?view=review', '/animals?view=none']);
    expect(links[0]!.getAttribute('aria-current')).toBe('page');
    expect(links[1]!.getAttribute('aria-current')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('Zahl als Marke, bei 0 oder ohne Zahl keine', () => {
    render(<ViewTabs label="Ansichten" tabs={tabs} current="review" />);
    expect(screen.getByRole('link', { name: 'Alle 6' })).toBeTruthy();
    expect(screen.getByTestId('tab-review').textContent).toBe('Prüfung offen');
    expect(screen.getByRole('link', { name: 'Ohne Zahl' })).toBeTruthy();
  });

  it('bricht nicht um, sondern scrollt waagerecht', () => {
    render(<ViewTabs label="Ansichten" tabs={tabs} current="all" />);
    const nav = screen.getByRole('navigation', { name: 'Ansichten' });
    expect(nav.innerHTML).toContain('overflow-x-auto');
    expect(nav.innerHTML).not.toContain('flex-wrap');
  });

  it('Zahl in Violett für Arbeit einer Maschine (tone agent, Board Vorschläge 1d)', () => {
    render(<ViewTabs label="Ansichten" tabs={[{ key: 'p', label: 'Vorschläge', href: '/p', count: 6, tone: 'agent', testId: 'tab-p' }, { key: 'a', label: 'Alle', href: '/a', count: 3, testId: 'tab-a' }, { key: 'z', label: 'Null', href: '/z', count: 0, tone: 'agent', testId: 'tab-z' }]} current="p" />);
    expect(within(screen.getByTestId('tab-p')).getByText('6').className).toContain('text-agent');
    expect(within(screen.getByTestId('tab-a')).getByText('3').className).toContain('text-badge-ink');
    expect(screen.getByTestId('tab-z').textContent).toBe('Null');
  });
});

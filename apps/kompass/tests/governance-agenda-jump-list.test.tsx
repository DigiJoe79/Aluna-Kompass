// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { AgendaJumpList, type AgendaJumpEntry } from '@/components/governance/agenda-jump-list';

afterEach(cleanup);
const entries: AgendaJumpEntry[] = [
  { key: 'a', number: '1', title: 'Begrüßung', summary: null, done: true, mark: null },
  { key: 'b', number: '2', title: 'Zelt', summary: 'angenommen', done: false, mark: { tone: 'warning', label: 'Begründung fehlt' } },
  { key: 'c', number: '3', title: 'Verschiedenes', summary: null, done: false, mark: null },
];

describe('AgendaJumpList (N4)', () => {
  it('a click selects the key; exactly one entry is current; the mark shows', () => {
    const select = vi.fn();
    render(
      <NextIntlClientProvider locale="de" messages={messages}>
        <AgendaJumpList entries={entries} current="b" onSelect={select} footer={null} label="Tagesordnung" />
      </NextIntlClientProvider>,
    );
    const nav = screen.getByRole('navigation', { name: 'Tagesordnung' });
    fireEvent.click(within(nav).getByRole('button', { name: /Verschiedenes/ }));
    expect(select).toHaveBeenCalledWith('c');
    expect(nav.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(within(nav).getByText('Begründung fehlt')).toBeTruthy();
  });
});

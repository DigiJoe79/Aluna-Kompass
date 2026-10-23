// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { RunSteps, type RunStep } from '@/components/run-steps';
import messages from '../messages/de.json';

afterEach(cleanup);

const Intl = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {children}
  </NextIntlClientProvider>
);

const steps: RunStep[] = [
  { key: 'a', label: 'Datenbank sichern', state: 'done' },
  { key: 'b', label: 'Dokumente und Bilder packen', state: 'running', counter: '2 von 4', progress: { done: 2, total: 4 } },
  { key: 'c', label: 'Archiv prüfen', state: 'pending' },
];

describe('RunSteps', () => {
  it('markiert den laufenden Schritt und zeigt seinen Fortschritt', () => {
    render(
      <Intl>
        <RunSteps steps={steps} label="Schritte" />
      </Intl>,
    );
    const items = within(screen.getByRole('list', { name: 'Schritte' })).getAllByRole('listitem');
    expect(items.map((li) => li.dataset.state)).toEqual(['done', 'running', 'pending']);
    expect(items[1]!.getAttribute('aria-current')).toBe('step');
    expect(items[0]!.hasAttribute('aria-current')).toBe(false);
    expect(screen.getByRole('progressbar', { name: 'Dokumente und Bilder packen' }).getAttribute('aria-valuenow')).toBe('50');
    expect(within(items[0]!).getByText(messages.common.runSteps.state.done)).toBeTruthy();
    expect(within(items[1]!).getByText('2 von 4')).toBeTruthy();
  });

  it('zeigt gescheitert mit Zustandswort und Satz, ohne aria-current', () => {
    render(
      <Intl>
        <RunSteps steps={[{ key: 'x', label: 'Prüfen', state: 'failed', note: 'Grund' }]} />
      </Intl>,
    );
    expect(screen.getByRole('list', { name: messages.common.runSteps.label })).toBeTruthy();
    const item = screen.getByRole('listitem');
    expect(item.dataset.state).toBe('failed');
    expect(item.hasAttribute('aria-current')).toBe(false);
    expect(within(item).getByText(messages.common.runSteps.state.failed)).toBeTruthy();
    expect(within(item).getByText('Grund')).toBeTruthy();
  });

  it('ohne total keinen Fortschrittsbalken', () => {
    render(
      <Intl>
        <RunSteps steps={[{ key: 'r', label: 'Läuft', state: 'running', progress: { done: 3, total: 0 } }, { key: 's', label: 'Auch', state: 'pending', progress: { done: 1, total: 2 } }]} />
      </Intl>,
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('setzt Kennungen je Zeile, wenn testId gesetzt ist', () => {
    render(
      <Intl>
        <RunSteps steps={steps} testId="lauf" />
      </Intl>,
    );
    expect(screen.getByTestId('lauf-b').dataset.state).toBe('running');
  });
});

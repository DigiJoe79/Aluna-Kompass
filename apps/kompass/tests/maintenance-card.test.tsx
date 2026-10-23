// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { JobStep, MaintenanceView } from '@kompass/core';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MaintenanceCard, maintenanceSteps } from '@/app/maintenance/maintenance-card';
import messages from '../messages/de.json';

afterEach(cleanup);

const Intl = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {children}
  </NextIntlClientProvider>
);

type Shown = Exclude<MaintenanceView, { phase: 'idle' }>;
const NOW = new Date('2026-10-23T08:35:00.000Z');
const STEPS: JobStep[] = [
  { key: 'safeguard', state: 'done' },
  { key: 'verify', state: 'done' },
  { key: 'replace', state: 'running', done: 2, total: 4 },
  { key: 'migrate', state: 'pending' },
  { key: 'finish', state: 'pending' },
];
const base = {
  runId: 'restore-20261023-1031',
  backupCreatedAt: '2026-10-23T01:00:00.000Z',
  startedAt: '2026-10-23T08:31:00.000Z',
  startedBy: 'Erika Beispiel',
  estimatedSeconds: 290,
  timeZone: 'Europe/Berlin',
  organization: 'Musterverein e.V.',
  steps: STEPS,
};
const login = messages.backup.maintenance.login;
const show = (view: Shown) =>
  render(
    <Intl>
      <MaintenanceCard view={view} appName="Kompass" now={NOW} />
    </Intl>,
  );
const states = () => screen.getAllByRole('listitem').map((li) => li.dataset.state);

describe('maintenanceSteps', () => {
  const label = (key: string) => key;
  it('läuft: Schritte in der Reihenfolge des Laufs, Fortschritt nur am laufenden', () => {
    const steps = maintenanceSteps({ phase: 'running', ...base }, label, 'rollback');
    expect(steps.map((s) => [s.key, s.state])).toEqual(STEPS.map((s) => [s.key, s.state]));
    expect(steps[2]!.progress).toEqual({ done: 2, total: 4 });
    expect(steps.every((s) => !s.counter)).toBe(true);
  });
  it('gescheitert ohne bekannten Schritt: nichts gescheitert, keine Zeile zum Zurückholen', () => {
    const steps = maintenanceSteps({ phase: 'failed', ...base, failedStep: null }, label, 'rollback');
    expect(steps.map((s) => s.key)).toEqual(STEPS.map((s) => s.key));
    expect(steps.some((s) => s.state === 'failed')).toBe(false);
  });
});

describe('MaintenanceCard', () => {
  it('running: Liste in Laufreihenfolge, ein Schritt läuft, kein Anmelden', () => {
    show({ phase: 'running', ...base });
    expect(states()).toEqual(['done', 'done', 'running', 'pending', 'pending']);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('link', { name: login })).toBeNull();
  });

  it.each([
    ['verify', ['done', 'failed', 'pending', 'pending', 'pending']],
    ['replace', ['done', 'done', 'failed', 'pending', 'pending', 'done']],
  ])('failed bei %s', (failedStep, expected) => {
    show({ phase: 'failed', ...base, failedStep });
    expect(states()).toEqual(expected);
    expect(screen.getByRole('link', { name: login }).getAttribute('href')).toBe('/login');
  });

  it('rollbackFailed: Mail-Link an die Vereinsadresse, Kennung, letzte Zeile gescheitert, kein Anmelden', () => {
    show({ phase: 'rollbackFailed', ...base, failedStep: 'migrate', aside: '/data/.before-import-x', contact: 'vorstand@example.org' });
    expect(screen.getByRole('link', { name: 'vorstand@example.org' }).getAttribute('href')).toBe('mailto:vorstand@example.org');
    expect(screen.getByText('restore-20261023-1031', { exact: false })).toBeTruthy();
    expect(states()).toEqual(['done', 'done', 'done', 'failed', 'pending', 'failed']);
    expect(screen.queryByRole('link', { name: login })).toBeNull();
  });

  it('rollbackFailed ohne contact: kein Mail-Link, Kennung bleibt', () => {
    show({ phase: 'rollbackFailed', ...base, failedStep: 'replace', aside: '/data/.before-import-x', contact: null });
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.getByText('restore-20261023-1031', { exact: false })).toBeTruthy();
  });

  it('done: Anmelden führt zu /login?imported=1, keine Schrittliste', () => {
    show({ phase: 'done', ...base });
    expect(screen.getByRole('link', { name: login }).getAttribute('href')).toBe('/login?imported=1');
    expect(screen.queryByRole('list')).toBeNull();
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { BlockedTermsPanel } from '@/app/(shell)/admin/site/blocked-terms-panel';
import { ConnectionCard } from '@/app/(shell)/admin/site/connection-card';
import { ConnectionPanel } from '@/app/(shell)/admin/site/connection-panel';
import { SiteJobContext } from '@/components/site/site-job-provider';

vi.mock('@/app/(shell)/admin/site/actions', () => ({ saveBlockedTermsAction: vi.fn(), clearSiteCacheAction: vi.fn() }));
vi.mock('@/app/(shell)/site/publish/actions', () => ({ startDeployCheckAction: vi.fn(), cancelSiteJobAction: vi.fn() }));

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const ready = { publicUrl: 'https://beispiel.invalid', staging: false, target: { host: 'h', user: 'u', path: '/web' }, auth: 'key', secret: 'set', ready: true } as const;

/** Nachtrag der Leitung 2026-10-02: Die Seite verlangt `site.manage`, der Verbindungstest dahinter `site.publish`. */
describe('Reiter Verbindung', () => {
  it('testet mit site.publish', () => {
    render(<ConnectionPanel summary={ready} canPublish />, { wrapper: Intl });
    expect(screen.getByRole('button', { name: 'Verbindung testen' })).toBeTruthy();
    expect(screen.queryByText(messages.site.admin.needsPublish)).toBeNull();
    expect(screen.getByText('u@h:/web')).toBeTruthy();
    expect(screen.getByText('gesetzt')).toBeTruthy();
  });

  it('zeigt ohne site.publish nur lesend und nennt das fehlende Recht', () => {
    render(<ConnectionPanel summary={ready} canPublish={false} />, { wrapper: Intl });
    expect(screen.queryByRole('button', { name: 'Verbindung testen' })).toBeNull();
    expect(screen.getByText(messages.site.admin.needsPublish)).toBeTruthy();
    expect(screen.getByText('u@h:/web')).toBeTruthy();
  });

  it('bietet bei halber Konfiguration keinen Testknopf', () => {
    render(<ConnectionPanel summary={{ ...ready, auth: 'password', secret: 'unreadable', ready: false }} canPublish />, { wrapper: Intl });
    expect(screen.queryByRole('button', { name: 'Verbindung testen' })).toBeNull();
    expect(screen.getByText('nicht lesbar')).toBeTruthy();
  });
});

describe('Reiter Gesperrte Begriffe', () => {
  it('lässt mit site.publish speichern', () => {
    render(<BlockedTermsPanel terms={['Popescu']} canPublish />, { wrapper: Intl });
    expect(screen.getByRole('button', { name: 'Sperrwörter speichern' })).toBeTruthy();
    expect((screen.getByLabelText('Begriffe, einer je Zeile') as HTMLTextAreaElement).readOnly).toBe(false);
  });

  it('zeigt ohne site.publish nur lesend und nennt das fehlende Recht', () => {
    render(<BlockedTermsPanel terms={['Popescu']} canPublish={false} />, { wrapper: Intl });
    expect(screen.queryByRole('button', { name: 'Sperrwörter speichern' })).toBeNull();
    const field = screen.getByLabelText('Begriffe, einer je Zeile') as HTMLTextAreaElement;
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe('Popescu');
    expect(screen.getByText(messages.site.admin.needsPublish)).toBeTruthy();
  });
});

describe('Verbindungstest, Ergebnis', () => {
  const detail = (over: object) => ({ runId: 'D1', kind: 'deployCheck', status: 'success', finishedAt: '2026-10-03T08:00:00.000Z', log: { text: '', truncated: false }, ...over });
  const renderCard = async (d: object) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ last: d }) })));
    const status = { enabled: true, running: null, last: { preview: null, publish: null, deployCheck: { runId: 'D1', kind: 'deployCheck', status: 'success' } }, track: () => {}, refresh: () => {} } as never;
    render(
      <SiteJobContext.Provider value={status}>
        <ConnectionCard />
      </SiteJobContext.Provider>,
      { wrapper: Intl },
    );
  };

  it('zeigt je Prüfpunkt einen Haken oder eine konkrete Meldung', async () => {
    await renderCard(
      detail({
        passed: false,
        target: 'web@host:/www',
        checks: [{ key: 'connect', outcome: 'ok' }, { key: 'targetDir', outcome: 'failed', problem: 'targetMissing' }, { key: 'writable', outcome: 'notRun' }, { key: 'targetFiles', outcome: 'notRun' }],
        filesAtTarget: { items: [], total: 0, truncated: false },
      }),
    );
    const list = await screen.findByRole('list', { name: 'Prüfpunkte' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Anmelden: in Ordnung',
      'Zielverzeichnis: Das Verzeichnis gibt es am Ziel nicht. Prüfen Sie SITE_DEPLOY_PATH.',
      'Schreibrecht: nicht geprüft',
      'Dateien am Ziel: nicht geprüft',
    ]);
    expect(screen.queryByText(/Verbindung steht/)).toBeNull();
  });

  it('zählt die Dateien, wenn alles bestanden ist', async () => {
    await renderCard(
      detail({
        passed: true,
        target: '/www',
        checks: [{ key: 'connect', outcome: 'ok' }, { key: 'targetDir', outcome: 'ok' }, { key: 'writable', outcome: 'ok' }, { key: 'targetFiles', outcome: 'ok' }],
        filesAtTarget: { items: ['index.html'], total: 1533, truncated: true },
      }),
    );
    expect(await screen.findByText('Verbindung steht. Am Ziel liegen 1.533 Dateien.')).toBeTruthy();
  });

  it('nennt ein Ergebnis aus 0.2.5-dev ohne Prüfpunkte „noch nicht getestet“', async () => {
    await renderCard(detail({ target: '/z', filesAtTarget: { items: ['a'], total: 1, truncated: false } }));
    expect(await screen.findByText('Noch nicht getestet.')).toBeTruthy();
  });
});

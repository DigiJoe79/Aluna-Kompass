// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { BlockedTermsPanel } from '@/app/(shell)/admin/site/blocked-terms-panel';
import { ConnectionCard } from '@/app/(shell)/admin/site/connection-card';
import { ConnectionPanel } from '@/app/(shell)/admin/site/connection-panel';
import { CachePanel } from '@/app/(shell)/admin/site/cache-panel';
import { SiteJobContext } from '@/components/site/site-job-provider';

vi.mock('@/app/(shell)/admin/site/actions', () => ({ saveBlockedTermsAction: vi.fn(), clearSiteCacheAction: vi.fn() }));
vi.mock('@/app/(shell)/site/publish/actions', () => ({ startDeployCheckAction: vi.fn(), cancelSiteJobAction: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ refresh: vi.fn() }) }));

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

  // 11-2 B16: kein doppelter Doppelpunkt („Ziel: lokales Verzeichnis: /deploy“).
  it('nennt ein lokales Ziel ohne zweiten Doppelpunkt', () => {
    render(<ConnectionPanel summary={{ ...ready, target: { host: null, user: null, path: '/deploy' } } as never} canPublish />, { wrapper: Intl });
    expect(document.body.textContent).toContain('/deploy (lokales Verzeichnis)');
    expect(document.body.textContent).not.toContain('Verzeichnis: /deploy');
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
    // K9-Befund 4: Speichern über die Leiste am Ende der Karte (MUSTER § B), nicht als eigener Knopf.
    expect(screen.getByRole('button', { name: 'Speichern' }).closest('[data-slot="form-action-bar"]')).toBeTruthy();
    expect((screen.getByLabelText('Begriffe, einer je Zeile') as HTMLTextAreaElement).readOnly).toBe(false);
  });

  it('zeigt ohne site.publish nur lesend und nennt das fehlende Recht', () => {
    render(<BlockedTermsPanel terms={['Popescu']} canPublish={false} />, { wrapper: Intl });
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
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

/** 11-2 B18: Die Zahlen des Caches stehen als Liste aus Begriff und Wert wie bei „Verbindung“. */
describe('Reiter Cache', () => {
  it('zeigt Bildvarianten und Vorschau als dl', () => {
    const status = { images: { count: 12, bytes: 3_145_728, oldest: '2026-10-01T08:00:00.000Z', newest: '2026-10-03T08:00:00.000Z' }, preview: { bytes: 1_048_576, builtAt: '2026-10-03T09:00:00.000Z' } };
    const value = { enabled: true, running: null, last: null, pending: null, track: () => {}, refresh: () => {} };
    render(
      <SiteJobContext.Provider value={value as never}>
        <CachePanel status={status as never} />
      </SiteJobContext.Provider>,
      { wrapper: Intl },
    );
    const terms = Array.from(document.querySelectorAll('dl dt')).map((d) => d.textContent);
    expect(terms).toEqual(['Bildvarianten', 'Zeitraum', 'Vorschau']);
    expect(document.querySelector('dl')!.textContent).toContain('12 · 3 MB');
  });
});

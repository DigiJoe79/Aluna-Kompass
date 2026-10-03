// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { type ReactElement, useContext } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { SiteJobProvider, SiteJobStoreContext, useSiteJobStatus } from '@/components/site/site-job-provider';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/dms' }));

const overview = (running: boolean) => ({
  running: running ? { runId: 'R1', kind: 'preview', source: 'mcp', userId: 'U', startedAt: 't', cancellable: true, elapsedMs: 0, userName: 'Erika', steps: [] } : null,
  last: { preview: null, deployCheck: null, publish: null },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SiteJobProvider', () => {
  /**
   * Ein neuer Abfragestand darf die Seite unter dem Provider nicht neu rendern:
   * Ein geänderter Context-Wert erreicht auch Suspense-Grenzen, die noch nicht
   * hydriert sind, und React rendert sie dann im Client neu — im Image blieb
   * der gestreamte Server-Teil (`<div hidden id="S:0">`) als zweite Kopie der
   * Seite im DOM (Image-Ring 0.2.5: dms.spec.ts:1234, finance-partners.spec.ts:383/633).
   */
  it('keeps its context value stable while consumers see each poll', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => overview(true) })));
    const values: unknown[] = [];
    function Probe() {
      values.push(useContext(SiteJobStoreContext));
      return null;
    }
    function Consumer() {
      const { running } = useSiteJobStatus();
      return <p data-testid="state">{running ? running.runId : 'ruhig'}</p>;
    }
    function Both() {
      return (
        <>
          <Probe />
          <Consumer />
        </>
      );
    }
    let rerender: (ui: ReactElement) => void = () => {};
    const tree = () => (
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <SiteJobProvider>
          <Both />
        </SiteJobProvider>
      </NextIntlClientProvider>
    );
    await act(async () => {
      ({ rerender } = render(tree()));
    });
    expect(screen.getByTestId('state').textContent).toBe('R1');
    await act(async () => rerender(tree()));
    expect(values.length).toBeGreaterThan(1);
    expect(new Set(values).size).toBe(1);
  });

  it('says so in the header toast when a finished connection test did not pass', async () => {
    const running = { runId: 'D1', kind: 'deployCheck', source: 'ui', userId: 'U', startedAt: 't', cancellable: true, elapsedMs: 0, userName: 'Erika', steps: [] };
    const none = { preview: null, publish: null };
    const results = [
      { running, last: { ...none, deployCheck: null } },
      { running: null, last: { ...none, deployCheck: { kind: 'deployCheck', runId: 'D1', status: 'success', passed: false, counts: {} } } },
    ];
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => results[Math.min(call++, 1)] })));
    function Poke() {
      const { refresh } = useSiteJobStatus();
      return <button onClick={refresh}>poke</button>;
    }
    await act(async () => {
      render(
        <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
          <SiteJobProvider>
            <Poke />
          </SiteJobProvider>
        </NextIntlClientProvider>,
      );
    });
    await act(async () => screen.getByRole('button', { name: 'poke' }).click());
    expect(toasts.error).toHaveBeenCalledWith('Verbindungstest: nicht bestanden.', expect.anything());
    expect(toasts.success).not.toHaveBeenCalled();
  });
});

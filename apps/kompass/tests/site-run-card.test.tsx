import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RunCard } from '@/app/(shell)/site/publish/run-card';
import { SiteJobContext, type SiteJobStatus } from '@/components/site/site-job-provider';
import messages from '../messages/de.json';

vi.mock('@/app/(shell)/site/publish/actions', () => ({ cancelSiteJobAction: async () => ({ status: 'idle' }) }));

type Running = NonNullable<SiteJobStatus['running']>;
const run = (over: Partial<Running> = {}): Running => ({
  runId: 'R1',
  kind: 'preview',
  source: 'mcp',
  userId: 'U',
  startedAt: '2026-10-03T08:00:00.000Z',
  cancellable: true,
  elapsedMs: 65_000,
  userName: 'Erika Beispiel',
  tokenName: 'Hundeblicke-Sync',
  steps: [
    { key: 'export', state: 'done' },
    { key: 'images', state: 'running', done: 342, total: 1533 },
    { key: 'build', state: 'pending' },
  ],
  ...over,
});
const render = (running: Running | null) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <SiteJobContext.Provider value={{ enabled: true, running, last: null, track: () => {}, refresh: () => {} }}>
        <RunCard />
      </SiteJobContext.Provider>
    </NextIntlClientProvider>,
  );

describe('RunCard', () => {
  it('lists every step with its state and counter, the source and the elapsed time', () => {
    const markup = render(run());
    expect(markup).toContain('aria-label="Laufender Lauf"');
    expect(markup).toContain('Inhalte prüfen');
    expect(markup).toContain('Bildvarianten');
    expect(markup).toContain('342 von 1.533');
    expect(markup).toContain('aria-valuetext="342 von 1.533"');
    expect(markup).toContain('fertig');
    expect(markup).toContain('läuft');
    expect(markup).toContain('wartet');
    expect(markup).toContain('Seite bauen');
    expect(markup).toContain('>MCP<');
    expect(markup).toContain('Hundeblicke-Sync · für Erika Beispiel um 10:00 Uhr');
    expect(markup).toContain('1:05');
    expect(markup).toContain('data-state="done"');
    expect(markup).toContain('data-state="running"');
    expect(markup).toContain('data-state="pending"');
  });
  it('leaves the token out when it is unknown', () => {
    const markup = render(run({ tokenName: null }));
    expect(markup).toContain('für Erika Beispiel um 10:00 Uhr');
    expect(markup).not.toContain('· für');
  });
  it('shows an adopted preview as skipped at once, with its note and the copy counter', () => {
    const markup = render(run({ steps: [{ key: 'export', state: 'done' }, { key: 'images', state: 'done' }, { key: 'build', state: 'skipped', done: 1200, total: 4113 }] }));
    expect(markup).toContain('Die Vorschau passt, sie wird übernommen.');
    expect(markup).toContain('Vorschau wird übernommen · 1.200 von 4.113');
    expect(markup).toContain('übersprungen');
  });
  it('can be cancelled while cancellable', () => {
    const markup = render(run());
    expect(markup).toMatch(/<button[^>]*>Abbrechen<\/button>/);
    expect(markup).not.toContain('aria-disabled');
  });
  it('locks the button with aria-disabled and says why once the transfer has begun', () => {
    const markup = render(run({ cancellable: false }));
    expect(markup).toMatch(/<button[^>]* aria-disabled="true"[^>]*>Abbrechen<\/button>/);
    expect(markup).not.toMatch(/<button[^>]* disabled=""/);
    const id = /<button[^>]*aria-describedby="([^"]+)"/.exec(markup)?.[1];
    expect(id).toBeTruthy();
    expect(markup).toContain(`id="${id}"`);
    expect(markup).toContain('Abbrechen geht nicht mehr');
  });
  it('shows the person instead of the badge for a run started in the interface', () => {
    const markup = render(run({ source: 'ui' }));
    expect(markup).not.toContain('>MCP<');
    expect(markup).toContain('Gestartet von Erika Beispiel um 10:00 Uhr');
  });
  it('can sit inside another card with a notice on top', () => {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <SiteJobContext.Provider value={{ enabled: true, running: run(), last: null, track: () => {}, refresh: () => {} }}>
          <RunCard embedded notice="Der Bild-Cache ist leer." />
        </SiteJobContext.Provider>
      </NextIntlClientProvider>,
    );
    expect(markup).toContain('Der Bild-Cache ist leer.');
    expect(markup).not.toContain('rounded-lg border');
  });
  it('renders nothing without a run', () => {
    expect(render(null)).toBe('');
  });
});

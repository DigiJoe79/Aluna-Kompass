import type { PublishSummary } from '@kompass/module-site';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublishHistory } from '@/app/(shell)/site/publish/history';
import messages from '../messages/de.json';

const row = (over: Partial<PublishSummary>): PublishSummary => ({
  id: 'P1',
  environment: 'test',
  startedAt: '2026-10-02T08:00:00.000Z',
  finishedAt: '2026-10-02T08:05:00.000Z',
  status: 'success',
  contentHash: 'a'.repeat(64),
  pagesChanged: 2,
  pagesAdded: 1,
  pagesRemoved: 0,
  summary: '',
  triggeredByUserId: 'U1',
  triggeredByName: 'Erika Beispiel',
  source: { channel: 'ui', tokenName: null },
  hasLog: true,
  ...over,
});
const render = (items: PublishSummary[], highlightId: string | null = null, total?: number) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <PublishHistory items={items} highlightId={highlightId} total={total} />
    </NextIntlClientProvider>,
  );

describe('PublishHistory', () => {
  /** Keine stille Grenze (MUSTER § L): Die Seite liest die jüngsten 20 und nennt die Gesamtzahl. */
  it('names the limit when the environment has more publishes than shown', () => {
    expect(render([row({}), row({ id: 'P2' })], null, 2)).not.toContain('Es werden');
    expect(render([row({}), row({ id: 'P2' })], null, 31)).toContain('Es werden die letzten 2 von 31 Publishes gezeigt.');
  });

  it('shows the name instead of the id and the status in words', () => {
    const markup = render([row({}), row({ id: 'P2', status: 'aborted', triggeredByUserId: null, triggeredByName: null, hasLog: false })]);
    expect(markup).toContain('Erika Beispiel');
    expect(markup).not.toContain('U1');
    expect(markup).toContain('Publiziert');
    expect(markup).toContain('Abgebrochen');
    expect(markup).toContain('System');
  });
  it('marks a publish started over MCP with the badge, the token and the person', () => {
    const markup = render([row({ source: { channel: 'mcp', tokenName: 'Hundeblicke-Sync' } })]);
    expect(markup).toContain('>MCP<');
    expect(markup).toContain('Hundeblicke-Sync · für Erika Beispiel');
  });
  it('shows no badge for the interface and a calm text for the system', () => {
    expect(render([row({})])).not.toContain('>MCP<');
    const markup = render([row({ source: { channel: 'system', tokenName: null }, triggeredByName: null })]);
    expect(markup).toContain('System (Neustart)');
    expect(markup).not.toContain('>MCP<');
  });
  it('offers the log only where there is one, and carries no log text', () => {
    const markup = render([row({}), row({ id: 'P2', hasLog: false })]);
    expect(markup.match(/<button[^>]*>Protokoll</g)).toHaveLength(1);
    expect(markup).not.toContain('<pre');
  });

  it('has the columns Zeit, Ergebnis, Änderungen, Von, Protokoll and no hash', () => {
    const markup = render([row({})]);
    const heads = [...markup.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(heads).toEqual(['Zeit', 'Ergebnis', 'Änderungen', 'Von', 'Protokoll']);
    expect(markup).not.toContain('aaaaaaaaaaaa');
  });
  it('words the changes and gives each status a symbol and a word', () => {
    const markup = render([row({ pagesChanged: 2, pagesAdded: 1, pagesRemoved: 0 }), row({ id: 'P2', status: 'failed' })]);
    expect(markup).toContain('2 geändert · 1 neu · 0 entfallen');
    expect(markup).toContain('Gescheitert');
    expect(markup.match(/<svg/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it('shows five rows and offers the older ones on request', () => {
    const rows = Array.from({ length: 7 }, (_, i) => row({ id: `P${i}`, startedAt: `2026-10-0${i + 1}T08:00:00.000Z` }));
    const markup = render(rows);
    expect(markup.match(/<tbody[^>]*>.*<\/tbody>/s)![0].match(/<tr/g)).toHaveLength(5);
    expect(markup).toContain('Ältere anzeigen');
    expect(render(rows.slice(0, 5))).not.toContain('Ältere anzeigen');
  });
  it('marks the entry that just ended as new', () => {
    const markup = render([row({ id: 'P1' }), row({ id: 'P2' })], 'P1');
    expect(markup.match(/>neu</g)).toHaveLength(1);
    // Hervorgehoben über den Zustand der Tabellenzeile, nicht über eine eigene Fläche (K10 Charge 2).
    expect(markup.match(/data-state="selected"/g)).toHaveLength(1);
  });
});

import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SiteJobIndicator } from '@/components/site/site-job-indicator';
import { SiteJobContext, type SiteJobStatus } from '@/components/site/site-job-provider';
import messages from '../messages/de.json';

const pending = (count: number, items = [{ key: 'k1', kind: 'changed' as const, label: 'Bruno', href: '/animals/A1', recordHref: '/animals/A1' }]) => ({ since: '2026-09-28T08:00:00.000Z', count, items, hrefs: items.flatMap((i) => (i.recordHref ? [i.recordHref] : [])), variables: [] });
const status = (running: SiteJobStatus['running'], p: SiteJobStatus['pending'] = null): SiteJobStatus => ({ enabled: true, running, last: null, pending: p, track: () => {}, refresh: () => {} });
const render = (value: SiteJobStatus) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messages}>
      <SiteJobContext.Provider value={value}>
        <SiteJobIndicator />
      </SiteJobContext.Provider>
    </NextIntlClientProvider>,
  );
const running = (steps: NonNullable<SiteJobStatus['running']>['steps']) => ({ runId: 'R', kind: 'preview' as const, source: 'mcp' as const, userId: 'U', startedAt: 't', cancellable: true, elapsedMs: 5000, userName: 'Erika', tokenName: null, steps });

describe('SiteJobIndicator', () => {
  it('shows kind, step and counter and links to the publish page', () => {
    const markup = render(status(running([{ key: 'export', state: 'done' }, { key: 'images', state: 'running', done: 342, total: 1533 }, { key: 'build', state: 'pending' }])));
    expect(markup).toContain('Vorschau · Bildvarianten 342 von 1.533');
    expect(markup).toContain('Vorschau 342 von 1.533');
    expect(markup).not.toContain('font-mono');
    expect(markup).toContain('href="/site/publish"');
    expect(markup).toContain('data-testid="site-job"');
  });
  it('shows a lone count when the total is unknown', () => {
    expect(render(status(running([{ key: 'images', state: 'running', done: 12 }])))).toContain('Bildvarianten 12');
  });
  it('renders nothing without a run or without a provider', () => {
    expect(render(status(null))).toBe('');
    expect(renderToStaticMarkup(<NextIntlClientProvider locale="de" messages={messages}><SiteJobIndicator /></NextIntlClientProvider>)).toBe('');
  });
  it('at rest shows the count in yellow, as word on the desktop and as icon with a label on the phone (Board 8a)', () => {
    const markup = render(status(null, pending(7)));
    expect(markup).toContain('7 nicht publiziert');
    expect(markup).toContain('border-warning');
    expect(markup).toContain('aria-label="7 Änderungen nicht publiziert, zum Publizieren"');
    expect(markup).toContain('href="/site/publish"');
  });
  it('shows nothing at zero, and the run instead of the count while one runs', () => {
    expect(render(status(null, pending(0, [])))).toBe('');
    const markup = render(status(running([{ key: 'export', state: 'running' }]), pending(7)));
    expect(markup).toContain('data-testid="site-job"');
    expect(markup).not.toContain('nicht publiziert');
  });
});

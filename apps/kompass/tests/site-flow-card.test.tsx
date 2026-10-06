// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { PublishConfirmDialog } from '@/app/(shell)/site/publish/confirm-dialog';
import { endText, PublishFlowCard, type PublishFlowCardProps } from '@/app/(shell)/site/publish/flow-card';
import type { FlowState } from '@/app/(shell)/site/publish/flow-state';
import { SiteJobContext } from '@/components/site/site-job-provider';
import type { DetailView } from '@/lib/site-job-view';

const check = vi.hoisted(() => vi.fn());
vi.mock('@/app/(shell)/site/publish/actions', () => ({ checkContentHashAction: check, cancelSiteJobAction: vi.fn() }));

const Intl = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {children}
  </NextIntlClientProvider>
);
const tDe = createTranslator({ locale: 'de', messages, namespace: 'site.publish' }) as unknown as Parameters<typeof endText>[1];

const zero = { changed: 0, added: 0, removed: 0, violations: 0, gaps: 0, stale: 0, pendingReview: 0, skippedImages: 0 };
const job = (over: Partial<DetailView> = {}): DetailView =>
  ({ kind: 'preview', runId: 'R', startedAt: '2026-10-03T08:00:00.000Z', finishedAt: '2026-10-03T08:05:00.000Z', userId: 'U', userName: 'Erika Beispiel', status: 'success', counts: { ...zero, changed: 3 }, contentHash: 'a'.repeat(64), log: { text: '', truncated: false }, ...over }) as DetailView;
const stateOf = (kind: FlowState['kind']): FlowState => {
  switch (kind) {
    case 'none':
      return { kind: 'none', lastPublishedAt: null };
    case 'outdated':
      return { kind: 'outdated', preview: job() };
    case 'ready':
      return { kind: 'ready', preview: job() };
    case 'unchanged':
      return { kind: 'unchanged', preview: job({ counts: zero }) };
    case 'blocked':
      return { kind: 'blocked', preview: job({ counts: { ...zero, violations: 1 }, violations: [{ path: 'variables.claim.de', term: 'popescu', excerpt: 'Frau Popescu', edit: { kind: 'variables' } }] }) };
    default:
      throw new Error(kind);
  }
};
const props = (state: FlowState, over: Partial<PublishFlowCardProps> = {}): PublishFlowCardProps => ({
  state,
  env: 'production',
  publicUrl: 'https://beispiel.invalid',
  hasDeploy: true,
  canManage: true,
  imageCacheEmpty: false,
  onRequestPublish: () => {},
  onStartPreview: () => {},
  onRetryPublish: () => {},
  onOpenLog: () => {},
  ...over,
});
const renderCard = (state: FlowState, over: Partial<PublishFlowCardProps> = {}) => render(<PublishFlowCard {...props(state, over)} />, { wrapper: Intl });
const primaries = () => screen.queryAllByRole('button').filter((b) => b.className.includes('bg-brand text-on-brand'));

beforeEach(() => check.mockReset());
afterEach(cleanup);

describe('PublishFlowCard', () => {
  it.each(['none', 'outdated', 'ready', 'unchanged', 'blocked'] as const)('%s has at most one primary button', (kind) => {
    renderCard(stateOf(kind));
    expect(primaries().length).toBeLessThanOrEqual(1);
  });
  it('ready: publish first, then the preview link, details closed', () => {
    renderCard(stateOf('ready'), { env: 'test' });
    expect(screen.getAllByRole('button')[0]!.textContent).toBe('Auf Test publizieren');
    expect(screen.getByRole('link', { name: /Vorschau öffnen/ })).toHaveProperty('pathname', '/site/preview-frame');
    expect(document.querySelector('details')!.hasAttribute('open')).toBe(false);
  });
  it('unchanged: no publish button, a quiet link-like action to publish anyway', () => {
    renderCard(stateOf('unchanged'));
    expect(screen.queryByRole('button', { name: /^(Jetzt|Auf Test) publizieren/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Trotzdem publizieren' }).className).toMatch(/underline/);
  });
  it('blocked: rebuild is the main action, publish is aria-disabled with a reason', () => {
    renderCard(stateOf('blocked'));
    expect(primaries().map((b) => b.textContent)).toEqual(['Vorschau neu bauen']);
    const locked = screen.getByRole('button', { name: /publizieren/ });
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    expect(locked.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Publizieren gesperrt' })).toBeTruthy();
  });
  it('development: never a publish button', () => {
    renderCard(stateOf('ready'), { env: 'development' });
    expect(screen.queryByRole('button', { name: /publizieren/i })).toBeNull();
    expect(screen.getByText('Hier wird nicht publiziert. Vorschau bauen und ansehen geht.')).toBeTruthy();
  });
  it('without a target: no publish button, a way to the connection for those who may', () => {
    renderCard(stateOf('ready'), { hasDeploy: false });
    expect(screen.queryByRole('button', { name: /publizieren/i })).toBeNull();
    expect(screen.getByRole('link', { name: 'Verbindung einrichten' })).toHaveProperty('search', '?panel=connection');
  });
  it('ended without red unless failed, and a failed publish offers the same preview again', () => {
    const { unmount } = renderCard({ kind: 'ended', job: job({ status: 'aborted', reason: 'cancelled', lastStep: 'images' }), retry: 'preview' });
    expect(document.querySelector('.text-error, .border-error')).toBeNull();
    unmount();
    renderCard({ kind: 'ended', job: job({ kind: 'publish', status: 'failed', failure: 'authFailed', lastStep: 'transfer' }), retry: 'publish' });
    expect(document.querySelector('.text-error')).not.toBeNull();
    expect(primaries().map((b) => b.textContent)).toEqual(['Erneut publizieren']);
  });
});

describe('end cards and the log', () => {
  const ended = (over: Partial<DetailView>) => ({ kind: 'ended', job: job(over), retry: 'preview' }) as FlowState;
  it.each([
    ['failed', { status: 'failed', failure: 'build' }],
    ['timeout', { status: 'aborted', reason: 'timeout', lastStep: 'images' }],
    ['interrupted', { status: 'interrupted', lastStep: 'export' }],
  ] as const)('offers "Protokoll ansehen" after %s and opens it for that run', (_n, over) => {
    const onOpenLog = vi.fn();
    renderCard(ended(over as Partial<DetailView>), { onOpenLog });
    screen.getByRole('button', { name: 'Protokoll ansehen' }).click();
    expect(onOpenLog).toHaveBeenCalledOnce();
  });
  it('offers none after a cancel by the person, nor after a success', () => {
    renderCard(ended({ status: 'aborted', reason: 'cancelled', lastStep: 'images' }), { onOpenLog: () => {} });
    expect(screen.queryByRole('button', { name: 'Protokoll ansehen' })).toBeNull();
    cleanup();
    renderCard(ended({ status: 'success' }), { onOpenLog: () => {} });
    expect(screen.queryByRole('button', { name: 'Protokoll ansehen' })).toBeNull();
  });
});

describe('endText', () => {
  it.each([
    [{ status: 'aborted', reason: 'timeout', lastStep: 'images', timeout: { limitMs: 1_800_000, stalled: false }, stoppedAt: { done: 342, total: 1533 } }, '„Bildvarianten“ lief länger als 30 Minuten und wurde bei 342 von 1.533 beendet.'],
    [{ status: 'aborted', reason: 'timeout', lastStep: 'build', timeout: { limitMs: 300_000, stalled: true }, stoppedAt: { done: 12 } }, '„Seite bauen“ kam 5 Minuten lang nicht voran und wurde bei 12 beendet.'],
    [{ kind: 'publish', status: 'failed', failure: 'authFailed', lastStep: 'transfer' }, 'Beim Übertragen hat der Webserver die Anmeldung abgelehnt.'],
    [{ kind: 'publish', status: 'failed', failure: 'authFailed', lastStep: 'transfer' }, 'Ein Teil wurde übertragen.'],
    [{ kind: 'publish', status: 'failed', failure: 'build', lastStep: 'build' }, 'Es wurde nichts übertragen'],
    [{ status: 'interrupted', lastStep: 'export' }, 'Kompass wurde während des Laufs neu gestartet. Er ist bei „Inhalte prüfen“ stehen geblieben.'],
    [{ status: 'aborted', reason: 'cancelled', lastStep: 'build' }, 'Der Lauf wurde bei „Seite bauen“ abgebrochen. Die Webseite hat sich nicht verändert.'],
  ] as const)('endText %#', (over, sentence) => expect(endText(job(over as Partial<DetailView>), tDe)).toContain(sentence));
});

describe('PublishConfirmDialog', () => {
  const footer = () => document.querySelector('[data-slot="form-action-bar"]') as HTMLElement;
  const dialog = (over: Partial<Parameters<typeof PublishConfirmDialog>[0]> = {}) => (
    <PublishConfirmDialog open onOpenChange={() => {}} env="production" publicUrl="https://beispiel.invalid" preview={job()} onPublish={() => {}} onRebuild={() => {}} {...over} />
  );

  it('checks first, then shows two buttons: fresh → cancel and publish', async () => {
    check.mockResolvedValueOnce({ status: 'success', data: { contentHash: 'a'.repeat(64) } });
    render(dialog(), { wrapper: Intl });
    expect(screen.getByRole('button', { name: 'Wird geprüft …' }).getAttribute('aria-busy')).toBe('true');
    await screen.findByRole('button', { name: 'Jetzt publizieren' });
    expect(within(footer()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Abbrechen', 'Jetzt publizieren']);
  });
  it('stale → cancel and rebuild, nothing else', async () => {
    check.mockResolvedValueOnce({ status: 'success', data: { contentHash: 'b'.repeat(64) } });
    render(dialog(), { wrapper: Intl });
    await screen.findByRole('button', { name: 'Vorschau neu bauen' });
    expect(within(footer()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Abbrechen', 'Vorschau neu bauen']);
    expect(screen.getByRole('alert').textContent).toContain('Vorschau nicht mehr aktuell');
  });
  it('closes first and passes the checked hash on publish', async () => {
    const onPublish = vi.fn();
    const onOpenChange = vi.fn();
    check.mockResolvedValueOnce({ status: 'success', data: { contentHash: 'a'.repeat(64) } });
    render(dialog({ onPublish, onOpenChange }), { wrapper: Intl });
    const publish = await screen.findByRole('button', { name: 'Jetzt publizieren' });
    await act(async () => publish.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onPublish).toHaveBeenCalledWith('a'.repeat(64));
  });
  it('closes first and starts the rebuild when stale', async () => {
    const onRebuild = vi.fn();
    const onOpenChange = vi.fn();
    check.mockResolvedValueOnce({ status: 'error', message: 'x' });
    render(dialog({ onRebuild, onOpenChange }), { wrapper: Intl });
    const rebuild = await screen.findByRole('button', { name: 'Vorschau neu bauen' });
    await act(async () => rebuild.click());
    await waitFor(() => expect(onRebuild).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it('says Test instead of the address on the test instance', async () => {
    check.mockResolvedValueOnce({ status: 'success', data: { contentHash: 'a'.repeat(64) } });
    render(dialog({ env: 'test' }), { wrapper: Intl });
    expect(screen.getByRole('alertdialog').textContent).toContain('Auf Test publizieren?');
    await screen.findByRole('button', { name: 'Auf Test publizieren' });
  });
});

describe('Hinweis bei leerem Bild-Cache', () => {
  const running = (kind: 'preview' | 'deployCheck') =>
    ({ runId: 'R1', kind, source: 'ui', userId: 'U', startedAt: '2026-10-03T08:00:00.000Z', cancellable: true, elapsedMs: 0, userName: 'Erika Beispiel', steps: [] }) as never;
  const renderRunning = (kind: 'preview' | 'deployCheck', imageCacheEmpty: boolean) =>
    render(
      <SiteJobContext.Provider value={{ enabled: true, running: running(kind), last: null, track: () => {}, refresh: () => {} }}>
        <PublishFlowCard {...props({ kind: 'running', run: running(kind) }, { imageCacheEmpty })} />
      </SiteJobContext.Provider>,
      { wrapper: Intl },
    );
  const HINT = /Nach dem Update ist der Bild-Cache leer/;

  it('erscheint in der Laufkarte der Vorschau, wenn der Cache leer ist', () => {
    renderRunning('preview', true);
    expect(screen.getByText(HINT)).toBeTruthy();
  });
  it('fehlt ohne die Angabe und beim Verbindungstest', () => {
    renderRunning('preview', false);
    expect(screen.queryByText(HINT)).toBeNull();
    cleanup();
    renderRunning('deployCheck', true);
    expect(screen.queryByText(HINT)).toBeNull();
  });
});

describe('LogDialog for a finished run', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('reads the log of the kind\'s last result, and falls back to the error message when it is empty', async () => {
    const { LogDialog, subjectOfJob } = await import('@/app/(shell)/site/publish/log-dialog');
    const failed = job({ kind: 'publish', status: 'failed', error: { code: 'publishFailed', message: 'rsync: connection refused' } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ last: { runId: 'R', log: { text: '' } } }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<LogDialog item={subjectOfJob(failed)} onClose={() => {}} />, { wrapper: Intl });
    await screen.findByText('rsync: connection refused');
    expect(fetchMock.mock.calls[0]![0]).toBe('/site/job/publish?log=full');
  });
});

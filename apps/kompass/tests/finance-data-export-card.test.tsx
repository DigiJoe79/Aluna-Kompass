// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataExportCard, type DataExportRow } from '@/app/(shell)/finance/reports/data-export-card';
import { IDLE_DATA_EXPORT, type DataExportRunView } from '@/lib/finance/data-export-view';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ startDataExportAction: vi.fn(), cancelDataExportAction: vi.fn() }));
vi.mock('@/app/(shell)/finance/reports/actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const YEARS = [
  { id: 'Y26', designation: '2026', closed: false },
  { id: 'Y25', designation: '2025', closed: true },
  { id: 'Y24', designation: '2024', closed: true },
];
const ROW: DataExportRow = { id: 'E1', createdAt: '2026-10-20T08:00:00.000Z', designations: '2025, 2026', provisional: '2026', byName: 'Anna Berger', sizeBytes: 3 * 1024 * 1024 };
const RUNNING: DataExportRunView = {
  state: 'running', runId: 'R1', cancellable: true, designations: '2024, 2025', finishedAt: null,
  steps: [{ key: 'entries', state: 'done' }, { key: 'masterData', state: 'done' }, { key: 'vouchers', state: 'running', done: 0, total: 1 }, { key: 'history', state: 'pending' }, { key: 'package', state: 'pending' }],
};

const show = (initial: DataExportRunView = IDLE_DATA_EXPORT, rows: DataExportRow[] = [ROW]) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DataExportCard initial={initial} rows={rows} years={YEARS} />
    </NextIntlClientProvider>,
  );

describe('Datenexport auf der Seite Berichte', () => {
  it('opens the dialog with the closed years ticked, newest first, and sends them', async () => {
    actions.startDataExportAction.mockResolvedValue({ status: 'success', message: '', fieldErrors: {} });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(RUNNING), { status: 200 }));
    show();
    fireEvent.click(screen.getByTestId('data-export-start'));
    const dialog = await screen.findByTestId('data-export-dialog');
    const boxes = within(dialog).getAllByRole('checkbox');
    expect(boxes.map((b) => b.getAttribute('id'))).toEqual(['data-export-year-Y26', 'data-export-year-Y25', 'data-export-year-Y24']);
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'true', 'true']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Erzeugen' }));
    await waitFor(() => expect(actions.startDataExportAction).toHaveBeenCalledWith(['Y25', 'Y24']));
  });

  it('keeps the dialog open and shows the refusal at the field without a year', async () => {
    actions.startDataExportAction.mockResolvedValue({ status: 'error', message: 'Bitte prüfen', fieldErrors: { fiscalYearIds: 'Wählen Sie mindestens ein Jahr.' } });
    show();
    fireEvent.click(screen.getByTestId('data-export-start'));
    const dialog = await screen.findByTestId('data-export-dialog');
    for (const box of within(dialog).getAllByRole('checkbox').filter((b) => b.getAttribute('aria-checked') === 'true')) fireEvent.click(box);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Erzeugen' }));
    await waitFor(() => expect(actions.startDataExportAction).toHaveBeenCalledWith([]));
    expect(await within(dialog).findByText('Wählen Sie mindestens ein Jahr.')).toBeTruthy();
    expect(screen.getByTestId('data-export-dialog')).toBeTruthy();
  });

  it('shows the five steps and cancelling while it runs', () => {
    show(RUNNING);
    const run = screen.getByTestId('data-export-run');
    const steps = within(run).getAllByRole('listitem');
    expect(steps).toHaveLength(5);
    expect(steps[2]!.getAttribute('aria-current')).toBe('step');
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeTruthy();
    expect(screen.queryByTestId('data-export-start')).toBeNull();
  });

  it('lists the exports with provisional years and a download per row, or says there is none', () => {
    show();
    const table = screen.getByRole('table', { name: 'Erzeugte Datenexporte' });
    expect(within(table).getByText('2025 · 2026 vorläufig')).toBeTruthy();
    expect(within(table).getByRole('button', { name: /^Export vom .+ herunterladen$/ })).toBeTruthy();
    cleanup();
    show(IDLE_DATA_EXPORT, []);
    expect(screen.getByText('Noch kein Export.')).toBeTruthy();
  });
});

describe('Datenexport: Stand abfragen (App-B4)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ein fehlgeschlagener Abruf beendet das Abfragen nicht: danach erscheint der fertige Stand', async () => {
    vi.useFakeTimers();
    const done: DataExportRunView = { ...RUNNING, state: 'success', cancellable: false, finishedAt: '2026-10-20T09:00:00.000Z' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response(JSON.stringify(done), { status: 200 }));
    show(RUNNING);
    expect(screen.getByTestId('data-export-run')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('data-export-run')).toBeNull();
  });

  it('nach dem Verlassen der Seite plant ein laufender Abruf keinen neuen', async () => {
    vi.useFakeTimers();
    let answer!: (r: Response) => void;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>((res) => (answer = res)));
    const { unmount } = show(RUNNING);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
    answer(new Response(JSON.stringify(RUNNING), { status: 200 }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

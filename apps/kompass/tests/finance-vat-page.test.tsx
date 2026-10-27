// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import { vatFigureRows } from '@/lib/finance/vat-figures';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace, push: vi.fn() }), usePathname: () => '/finance/vat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(shell)/finance/deadlines/actions', () => ({ recordVatFilingAction: vi.fn(async () => ({ status: 'success', data: { id: 'F2' } })) }));
vi.mock('@/app/(shell)/finance/vat/actions', () => ({ updateVatFilingAction: vi.fn(async () => ({ status: 'success' })), fileVatFilingDocumentAction: vi.fn(async () => ({ status: 'success' })), linkVatFilingDocumentAction: vi.fn(async () => ({ status: 'success' })) }));
vi.mock('@/app/(shell)/finance/reports/actions', () => ({ finalizeReportAction: vi.fn(async () => ({ status: 'success' })) }));
const { VatFiguresTable } = await import('@/app/(shell)/finance/vat/vat-figures-table');
const { VatFilingCard } = await import('@/app/(shell)/finance/vat/vat-filing-card');
const { VatHeader, VatPeriodBar } = await import('@/app/(shell)/finance/vat/vat-header');

afterEach(cleanup);
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  vi.clearAllMocks();
});

const wrap = (node: ReactNode) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        {node}
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
const m = messages.finance.vat;

const VALUES = [
  { source: 'rc13bEuBase', cents: 32000, entryIds: ['E1', 'E2'] },
  { source: 'rc13bEuTax', cents: 6080, entryIds: ['E1', 'E2'] },
  { source: 'rc13bOtherBase', cents: 0, entryIds: [] },
  { source: 'result', cents: 6080, entryIds: [] },
];
const rows = (amendment: boolean, filed: Record<string, number> | null = { rc13bEuBase: 20000, rc13bEuTax: 3800, result: 3800 }) => vatFigureRows({ formYear: 2026, taxation: 'smallBusiness', values: VALUES, filed, amendment });
const figureRow = (code: string) => document.querySelector(`[data-figure="${code}"]`) as HTMLElement | null;

/** Plan E6b Task 8 — Seite „Umsatzsteuer-Voranmeldung“ (Board 8a, 8b). */
describe('Kennzahlen', () => {
  it('shows only figures with a value and links the entries', () => {
    wrap(<VatFiguresTable rows={rows(false)} amendment={false} filedMissing={false} notes={[]} />);
    expect(figureRow('46')).toBeTruthy();
    expect(figureRow('47')).toBeTruthy();
    expect(figureRow('83')).toBeTruthy();
    expect(figureRow('84')).toBeNull();
    expect(figureRow('10')).toBeNull();
    expect(within(figureRow('46')!).getByRole('link').getAttribute('href')).toBe('/finance/entries?ids=E1,E2');
  });

  it('puts the filed values next to the amended ones', () => {
    wrap(<VatFiguresTable rows={rows(true)} amendment filedMissing={false} notes={[]} />);
    const all = [...document.querySelectorAll('[data-figure]')].map((r) => r.getAttribute('data-figure'));
    expect(all[0]).toBe('10');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining([m.figures.columns.filed, m.figures.columns.amended]));
    expect(figureRow('46')!.querySelector('[data-changed]')).toBeTruthy();
    cleanup();
    wrap(<VatFiguresTable rows={rows(true, null)} amendment filedMissing notes={[]} />);
    expect(screen.getByTestId('vat-filed-missing')).toBeTruthy();
  });
});

describe('Kopf und Abgabe', () => {
  const header = (canFinalize: boolean) => (
    <VatHeader periodKey="2026-Q2" periodLabel="Q2 2026" stage="review" amendmentDue={false} dueOn="2026-07-10" filedOn={null} shortHash="4e1b77c2" generatedAt="2026-07-08T10:00:00.000Z" today="2026-07-08" finalizeBlock={null} canFinalize={canFinalize} pdfHref="/finance/reports/vatAdvanceReturn/preview?period=2026-Q2" />
  );

  it('offers finalizing only with the right', () => {
    wrap(header(true));
    expect(screen.getByTestId('vat-finalize')).toBeTruthy();
    cleanup();
    wrap(header(false));
    expect(screen.queryByTestId('vat-finalize')).toBeNull();
  });

  it('opens the dialog with the date of the last filing', async () => {
    wrap(
      <VatFilingCard
        periodKey="2026-Q2"
        periodLabel="Q2 2026"
        dueOn="2026-07-10"
        kind="quarter"
        permanentExtension={false}
        resultCents={3800}
        lastFiling={{ id: 'F1', filedOn: '2026-07-08', reportId: null, documents: {} }}
        amendmentDue={false}
        finalized={false}
        canEdit
        today="2026-10-25"
      />,
    );
    fireEvent.click(screen.getByTestId('vat-filing-edit'));
    const dialog = await screen.findByTestId('vat-dialog');
    expect((within(dialog).getByLabelText(messages.finance.deadlines.vatDialog.date, { exact: false }) as HTMLInputElement).value).toBe('2026-07-08');
  });

  it('chooses the period through the address', () => {
    wrap(<VatPeriodBar period="2026-Q2" options={[{ key: '2026-Q3', label: 'Q3 2026' }, { key: '2026-Q2', label: 'Q2 2026' }]} />);
    fireEvent.change(screen.getByTestId('vat-period-select'), { target: { value: '2026-Q3' } });
    expect(replace).toHaveBeenCalledWith('/finance/vat?period=2026-Q3');
  });
});

/** Plan E9 Task 1 (Befund 30 a, Bilder 338/341): Die abgegebene Fassung ist ein PDF aus ELSTER, das man ablegt (Board 8b). */
describe('Abgegebene Fassung', () => {
  const card = (props: { reportId: string | null; documents?: Record<string, { documentId: string; documentNumber: string }>; amendmentDue?: boolean; finalized?: boolean; canEdit?: boolean }) => (
    <VatFilingCard
      periodKey="2026-Q2"
      periodLabel="Q2 2026"
      dueOn="2026-07-10"
      kind="quarter"
      permanentExtension={false}
      resultCents={3800}
      lastFiling={{ id: 'F1', filedOn: '2026-07-08', reportId: props.reportId, documents: props.documents ?? {} }}
      amendmentDue={props.amendmentDue ?? false}
      finalized={props.finalized ?? true}
      canEdit={props.canEdit ?? true}
      canPickDocument
      today="2026-10-25"
    />
  );
  const row = (key: string) => screen.getByTestId(`requirement-${key}`);

  it('offers filing the return once the filing has a finalized version', async () => {
    wrap(card({ reportId: 'R1' }));
    expect(row('filedReturn').getAttribute('data-blocked')).toBe('false');
    fireEvent.click(within(row('filedReturn')).getByTestId('vat-file-filedReturn'));
    expect(await screen.findByTestId('vat-document-dialog')).toBeTruthy();
  });

  it('waits for the finalized version and offers nothing without the right', () => {
    wrap(card({ reportId: null }));
    expect(row('filedReturn').getAttribute('data-blocked')).toBe('true');
    expect(screen.queryByTestId('vat-file-filedReturn')).toBeNull();
    cleanup();
    wrap(card({ reportId: 'R1', canEdit: false }));
    expect(screen.queryByTestId('vat-file-filedReturn')).toBeNull();
  });

  it('keeps the old version done while the amended one waits for finalizing', () => {
    wrap(card({ reportId: 'R1', documents: { filedReturn: { documentId: 'D1', documentNumber: 'UST-2026-002' } }, amendmentDue: true, finalized: false }));
    expect(row('filedReturn').getAttribute('data-done')).toBe('true');
    expect(row('amended').getAttribute('data-blocked')).toBe('true');
    expect(screen.queryByTestId('vat-file-filedReturn')).toBeNull();
  });
});

describe('Abgabe vor dem Ende des Zeitraums', () => {
  it('ohne „Bearbeiten …“, mit „Abgabe ab …“ unter „Abgegeben am“', () => {
    wrap(
      <VatFilingCard
        periodKey="2026-Q4"
        periodLabel="Q4 2026"
        dueOn="2027-01-11"
        kind="quarter"
        permanentExtension={false}
        resultCents={0}
        lastFiling={null}
        amendmentDue={false}
        finalized={false}
        canEdit
        today="2026-10-25"
      />,
    );
    expect(screen.queryByTestId('vat-filing-edit')).toBeNull();
    expect(screen.getByText('Abgabe ab 01.01.2027')).toBeTruthy();
  });
});

/** Designer Runde 8, 9a/9b (340, 341, 345): Kopf und Abgabe-Karte in ihren Zuständen. */
describe('Kopfzustände', () => {
  const head = (props: Partial<Parameters<typeof VatHeader>[0]>) => (
    <VatHeader periodKey="2026-Q2" periodLabel="Q2 2026" stage="review" amendmentDue={false} dueOn="2026-07-10" filedOn={null} shortHash="4e1b77c2" generatedAt="2026-10-26T10:00:00.000Z" today="2026-07-08" finalizeBlock={null} canFinalize={false} pdfHref="/x?y" {...props} />
  );

  it('festgeschrieben: nennt die Fassung aus der Akte statt des heutigen Laufs', () => {
    wrap(head({ stage: 'final', filedOn: '2026-07-08', finalVersion: { finalizedAt: '2026-07-08T07:14:00.000Z', shortHash: 'f9d1bcc0', documentNumber: 'UST-2026-003' } }));
    const text = screen.getByTestId('vat-header').textContent!;
    expect(text).toContain('UST-2026-003');
    expect(text).toContain('08.07.2026');
    expect(text).not.toContain('26.10.2026');
  });

  it('verstrichene Frist ohne Abgabe: der Kopf nennt sie, das Feld trägt die Marke', () => {
    wrap(head({ today: '2026-10-26', dueOn: '2026-10-12' }));
    expect(screen.getByTestId('vat-header').textContent).toContain('12.10.2026');
    cleanup();
    const card = (today: string) => (
      <VatFilingCard periodKey="2026-Q3" periodLabel="Q3 2026" dueOn="2026-10-12" kind="quarter" permanentExtension={false} resultCents={931} lastFiling={null} amendmentDue={false} finalized={false} canEdit today={today} />
    );
    wrap(card('2026-10-26'));
    expect(screen.getByTestId('vat-overdue')).toBeTruthy();
    // Vor dem Festschreiben warten beide Dokumentzeilen.
    expect(screen.getByTestId('requirement-filedReturn').dataset.blocked).toBe('true');
    expect(screen.getByTestId('requirement-transmissionProtocol').dataset.blocked).toBe('true');
    cleanup();
    wrap(card('2026-10-12'));
    expect(screen.queryByTestId('vat-overdue')).toBeNull();
  });

  it('offene Berichtigung: „Zu zahlen“ ist die Nachzahlung aus dem Dienst', () => {
    wrap(
      <VatFilingCard
        periodKey="2026-Q2"
        periodLabel="Q2 2026"
        dueOn="2026-07-10"
        kind="quarter"
        permanentExtension={false}
        resultCents={6080}
        lastFiling={{ id: 'F1', filedOn: '2026-07-08', reportId: 'R1', documents: {} }}
        amendmentDue
        amendmentPayment={{ amendedCents: 6080, filedCents: 3800, payableCents: 2280, filedOn: '2026-07-08', first: true }}
        finalized={false}
        canEdit
        today="2026-10-26"
      />,
    );
    const payable = screen.getByTestId('vat-payable').textContent!;
    expect(payable).toContain('22,80');
    expect(payable).toContain('60,80');
    expect(payable).toContain('38,00');
    expect(screen.queryByTestId('vat-overdue')).toBeNull();
  });
});

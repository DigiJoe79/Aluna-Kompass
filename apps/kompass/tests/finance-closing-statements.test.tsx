// @vitest-environment jsdom
import type { AccountYearStatementRow, ClosingStatus, ClosingStepView } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/closing', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
vi.mock('@/app/(shell)/finance/closing/actions', () => ({
  confirmStepAction: vi.fn(),
  closeYearAction: vi.fn(),
  reopenYearAction: vi.fn(),
  confirmStatementsStepAction: vi.fn(async () => ({ status: 'success' })),
  confirmAccountAction: vi.fn(async () => ({ status: 'success' })),
  fileStatementAction: vi.fn(async () => ({ status: 'success', data: { documentNumber: 'D-1' } })),
  linkStatementAction: vi.fn(async () => ({ status: 'success', data: { documentNumber: 'D-1' } })),
  suggestStatementAction: vi.fn(async () => ({ periodFrom: '2025-12-01', periodTo: '2025-12-31', covers: true, balanceAtYearEndCents: 169850 })),
}));
const { StatementsStep } = await import('@/app/(shell)/finance/closing/steps/statements');
const { StatementDialog } = await import('@/app/(shell)/finance/closing/statement-dialog');
const { ClosingSteps } = await import('@/app/(shell)/finance/closing/closing-steps');
const actions = await import('@/app/(shell)/finance/closing/actions');

afterEach(cleanup);
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  vi.clearAllMocks();
});

/** Schritt 1 „Auszüge und Konten“ (Plan C2 Task 4, Board 13b/13c): Zeilen je Konto, Kästchen, Dialoge. */
const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);

const row = (over: Partial<AccountYearStatementRow>): AccountYearStatementRow => ({ accountId: 'a', name: 'Konto', kind: 'bank', needsPdf: false, statement: null, lastStatementTo: null, lastMovementOn: '2025-12-20', balanceAtYearEndCents: 169850, importedBalance: null, confirmation: null, ...over });
const ROWS = [
  row({ accountId: 'giro', name: 'Vereinskonto', statement: { documentId: 'd1', documentNumber: 'A-12', periodFrom: '2025-12-01', periodTo: '2025-12-31', covers: true } }),
  row({ accountId: 'zweit', name: 'Zweitbank', needsPdf: true, lastStatementTo: '2025-11-30' }),
  row({ accountId: 'platform', name: 'Spendenplattform', kind: 'paymentService', importedBalance: { cents: 0, on: '2025-12-31' } }),
  row({ accountId: 'paypal', name: 'PayPal', kind: 'paymentService', confirmation: { kind: 'notReconcilable', note: null, at: '2026-01-08T10:00:00Z', byUserId: 'u1' } }),
];
const step = (accounts = ROWS, done = false): ClosingStepView<{ key: 'statements'; accounts: AccountYearStatementRow[]; accountsWithoutImport: number; openTransactions: number }> => ({ key: 'statements', number: 1, group: 'before', done, confirmable: true, confirmation: done ? { note: null, at: '2026-01-10T10:00:00Z', byUserId: 'u1' } : null, facts: { key: 'statements', accounts, accountsWithoutImport: 0, openTransactions: 0 } });
const STATUS = { fiscalYearId: 'y25', designation: '2025', startsOn: '2025-01-01', endsOn: '2025-12-31', ended: true, yearStatus: 'open', doneCount: 0, next: 'statements', reopened: null, toRepeat: [], handovers: [], steps: [], me: { canConfirm: true, canClose: true, canHandover: false } } as unknown as ClosingStatus;
const body = (over: { canConfirm?: boolean; canWrite?: boolean; accounts?: AccountYearStatementRow[] } = {}) => <StatementsStep step={step(over.accounts)} status={STATUS} canConfirm={over.canConfirm ?? true} canWrite={over.canWrite ?? true} onConfirm={() => undefined} names={{ u1: 'Anna Berger' }} />;

describe('Schritt 1: Zeilen je Konto', () => {
  it('nur „fehlt“ ist eine Marke; liegender Auszug als Link in die Akte; Knöpfe nach Zustand', () => {
    wrap(body());
    const rows = screen.getAllByTestId('closing-statement-row');
    const byId = (id: string) => rows.find((r) => r.getAttribute('data-account') === id)!;
    expect(document.querySelectorAll('[data-slot="status-badge"]')).toHaveLength(1);
    expect(within(byId('zweit')).getByText(m('finance.closing.statements.missing'))).toBeTruthy();
    expect(within(byId('giro')).getByRole('link', { name: /A-12/ }).getAttribute('href')).toBe('/dms/d1');
    expect(within(byId('zweit')).getByTestId('closing-statement-file')).toBeTruthy();
    expect(within(byId('platform')).getByTestId('closing-statement-service')).toBeTruthy();
    expect(within(byId('paypal')).queryByRole('button', { name: m('finance.closing.statements.confirmService') })).toBeNull();
    expect(byId('paypal').textContent).toContain('Anna Berger');
  });

  it('„Schritt erledigen“ gesperrt, bis angekreuzt — offene Zeilen sperren nicht', async () => {
    wrap(body());
    const finish = screen.getByTestId('closing-statements-finish') as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('closing-statements-all'));
    expect(finish.disabled).toBe(false);
    fireEvent.click(finish);
    await waitFor(() => expect(actions.confirmStatementsStepAction).toHaveBeenCalledWith('y25'));
  });

  it('ohne Recht: kein Kästchen, kein Knopf', () => {
    wrap(body({ canConfirm: false, canWrite: false }));
    expect(screen.queryByTestId('closing-statements-finish')).toBeNull();
    expect(screen.queryByTestId('closing-statement-file')).toBeNull();
    expect(screen.queryByTestId('closing-statement-service')).toBeNull();
  });

  it('Zahlungsdienst bestätigen: Wahl, dann Bestätigen mit der Art', async () => {
    wrap(body());
    fireEvent.click(screen.getByTestId('closing-statement-service'));
    const dialog = await screen.findByTestId('closing-service-dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: m('finance.closing.statements.serviceDialog.balanceConfirmed') }));
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.closing.statements.serviceDialog.save') }));
    await waitFor(() => expect(actions.confirmAccountAction).toHaveBeenCalledWith('y25', 'platform', 'balanceConfirmed', null));
  });

  it('erledigt als eine Zeile mit Zahlen und Begründung', () => {
    const accounts = [ROWS[0]!, row({ accountId: 'zweit', name: 'Zweitbank', confirmation: { kind: 'missingJustified', note: 'Bank verschickt im Februar', at: '2026-01-08T10:00:00Z', byUserId: 'u1' } }), ROWS[3]!];
    const status = { ...STATUS, steps: [step(accounts, true)], next: null, doneCount: 1 } as unknown as ClosingStatus;
    wrap(<ClosingSteps status={{ ...status, ended: true, next: 'cash' as const }} names={{}} />);
    const text = document.getElementById('step-statements')!.textContent!;
    expect(text).toContain('1');
    expect(text).toContain('Zweitbank (Bank verschickt im Februar)');
  });
});

describe('Dialog „Auszug ablegen“', () => {
  const account = { accountId: 'zweit', name: 'Zweitbank', lastMovementOn: '2025-12-20', balanceAtYearEndCents: 169850 };
  it('Datei wählen füllt „Bis“ als Vorschlag vor; der Satz sagt, ob der Stichtag gedeckt ist; Ablegen schickt Datei und Zeitraum', async () => {
    wrap(<StatementDialog open onOpenChange={() => undefined} fiscalYearId="y25" endsOn="2025-12-31" account={account} />);
    const dialog = await screen.findByTestId('closing-statement-dialog');
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.4'], 'auszug.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect((within(dialog).getByLabelText(new RegExp(`^${m('finance.closing.statements.fileDialog.to')}`)) as HTMLInputElement).value).toBe('2025-12-31'));
    expect(within(dialog).getAllByText(m('finance.closing.statements.fileDialog.suggested')).length).toBeGreaterThan(0);
    expect(within(dialog).getByTestId('closing-statement-covers').getAttribute('data-covers')).toBe('true');
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${m('finance.closing.statements.fileDialog.to')}`)), { target: { value: '2025-11-30' } });
    expect(within(dialog).getByTestId('closing-statement-covers').getAttribute('data-covers')).toBe('false');
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.closing.statements.fileDialog.save') }));
    await waitFor(() => expect(actions.fileStatementAction).toHaveBeenCalled());
    const sent = vi.mocked(actions.fileStatementAction).mock.calls[0]![0] as FormData;
    expect(sent.get('accountId')).toBe('zweit');
    expect(sent.get('periodTo')).toBe('2025-11-30');
    expect(sent.get('file')).toBeInstanceOf(File);
  });
});

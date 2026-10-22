// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { columnsNote, ColumnsStep } from '@/app/(shell)/finance/imports/format/columns-step';
import type { AssistantState, ColumnRole } from '@/lib/finance/csv-assistant-state';
import messages from '../messages/de.json';

/** Schritt 3 des CSV-Assistenten als Liste (Spec 2026-10-22): Verhalten, Rollen, Zustände — keine Optik. */
function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const header = ['Datum', 'Uhrzeit', 'Name', 'Brutto', 'Status', 'E-Mail'];
const rows = [
  ['01.03.2026', '', 'Erika Beispiel', '25,00', 'Abgeschlossen', 'erika.beispiel@example.org'],
  ['02.03.2026', '', 'Tierbedarf Beispielstadt GmbH', '-89,90', 'Ausstehend', 'vorstand@musterverein.example'],
  ['03.03.2026', ' ', 'Erika Beispiel', '10,00', 'Abgeschlossen', 'erika.beispiel@example.org'],
];
const ROLES: ColumnRole[] = ['bookingDate', 'ignore', 'counterpartyName', 'amount', 'pending', 'ignore'];

const makeState = (over: Partial<AssistantState> = {}): AssistantState => ({
  step: 3,
  settings: { encoding: 'utf-8', delimiter: ';', headerRow: 0, dateFormat: 'DD.MM.YYYY', decimalSeparator: ',' },
  roles: ROLES,
  guessed: [true, false, true, true, true, false],
  indicatorValues: '',
  pendingValues: '',
  invertSign: null,
  name: 'X',
  ...over,
});

function Harness({ initial = makeState() }: { initial?: AssistantState }) {
  const [state, setState] = useState(initial);
  return <ColumnsStep header={header} rows={rows} state={state} onChange={setState} />;
}

const show = (initial?: AssistantState) =>
  render(
    <Intl>
      <Harness initial={initial} />
    </Intl>,
  );

const row = (column: string, scope: HTMLElement = document.body) => scope.querySelector<HTMLElement>(`[data-testid="csv-column"][data-column="${column}"]`)!;
const roleSelect = (column: string) => screen.getByLabelText(`Rolle der Spalte „${column}“`) as HTMLSelectElement;
const more = () => screen.getByRole('region', { name: messages.finance.csvAssistant.columns.more });

describe('ColumnsStep', () => {
  it('required block: three done, ‚Werte für vorgemerkt‘ open', () => {
    show();
    const pending = screen.getByTestId('requirement-pendingValues');
    expect(pending.dataset.done).toBe('false');
    expect(within(pending).getByText(messages.finance.csvAssistant.columns.missingItem)).toBeTruthy();
    for (const key of ['bookingDate', 'amount', 'nameOrPurpose']) expect(screen.getByTestId(`requirement-${key}`).dataset.done).toBe('true');
    expect(screen.getByTestId('requirement-bookingDate').textContent).toContain('Datum');
  });

  it('guessed rows carry ‚vorbelegt‘ until the role changes', () => {
    show();
    const guessed = messages.finance.csvAssistant.columns.guessed;
    expect(within(row('Name')).getByText(guessed)).toBeTruthy();
    expect(screen.getByText(/^4 Spalten/)).toBeTruthy();
    fireEvent.change(roleSelect('Name'), { target: { value: 'purpose' } });
    fireEvent.change(roleSelect('Name'), { target: { value: 'counterpartyName' } });
    expect(roleSelect('Name').value).toBe('counterpartyName');
    expect(within(row('Name')).queryByText(guessed)).toBeNull();
    expect(screen.getByText(/^3 Spalten/)).toBeTruthy();
  });

  it('more columns are folded, searchable, and a chosen role grows in place', async () => {
    show();
    const region = more();
    const details = region.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(region.querySelector('summary')!.textContent).toContain('· 2');
    fireEvent.click(region.querySelector('summary')!);
    expect(details.open).toBe(true);

    const search = within(region).getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'mail' } });
    await waitFor(() => expect(within(region).getAllByTestId('csv-column').map((r) => r.dataset.column)).toEqual(['E-Mail']));

    fireEvent.change(search, { target: { value: 'xyz' } });
    await waitFor(() => expect(within(region).queryAllByTestId('csv-column')).toHaveLength(0));
    expect(within(region).getByText(/xyz/)).toBeTruthy();

    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() => expect(within(region).getAllByTestId('csv-column')).toHaveLength(2));

    fireEvent.change(search, { target: { value: 'mail' } });
    await waitFor(() => expect(within(region).getAllByTestId('csv-column')).toHaveLength(1));
    expect(row('E-Mail', region).dataset.compact).toBe('true');
    fireEvent.change(roleSelect('E-Mail'), { target: { value: 'counterpartyEmail' } });
    const grown = row('E-Mail', region);
    expect(grown).not.toBeNull();
    expect(grown.dataset.compact).toBe('false');
    expect(grown.dataset.role).toBe('counterpartyEmail');
    expect(screen.getByText(`${messages.finance.csvAssistant.columns.withRoleOnEntry} · 4`)).toBeTruthy();
  });

  it('empty column says so', () => {
    show();
    expect(within(row('Uhrzeit')).getByText(/3/)).toBeTruthy();
  });

  it('values field at the status row with the values found', () => {
    show();
    const field = within(row('Status')).getByLabelText(messages.finance.csvAssistant.columns.pendingValues);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const hint = document.getElementById(field.getAttribute('aria-describedby')!.split(' ').at(-1)!)!;
    expect(hint.textContent).toContain('Abgeschlossen, Ausstehend');
  });

  it('duplicate role marks both rows', () => {
    show();
    fireEvent.change(roleSelect('Uhrzeit'), { target: { value: 'bookingDate' } });
    expect(roleSelect('Uhrzeit').getAttribute('aria-invalid')).toBe('true');
    expect(roleSelect('Datum').getAttribute('aria-invalid')).toBe('true');
    expect(roleSelect('Name').getAttribute('aria-invalid')).not.toBe('true');
    expect(screen.getAllByText(messages.finance.csvAssistant.columns.reasons.duplicateRole)).toHaveLength(2);
  });

  it('no role at entry: one list without empty group', () => {
    show(makeState({ roles: ROLES.map(() => 'ignore'), guessed: [] }));
    expect(screen.queryByText(new RegExp(messages.finance.csvAssistant.columns.withRole))).toBeNull();
    expect(document.querySelector('details')).toBeNull();
    expect(screen.getAllByTestId('csv-column')).toHaveLength(6);
  });

  it('e-mail values break after @ and .', () => {
    show();
    const mail = row('E-Mail');
    expect(mail.querySelectorAll('wbr').length).toBeGreaterThan(0);
    const described = roleSelect('E-Mail').getAttribute('aria-describedby')!;
    expect(document.getElementById(described)!.textContent).toContain('erika.beispiel@example.org');
  });
});

function Note({ state }: { state: AssistantState }) {
  const t = useTranslations('finance.csvAssistant.columns');
  return <p data-testid="note">{columnsNote(header, state, t)}</p>;
}

describe('columnsNote', () => {
  it('names what is open, or that all is set', () => {
    render(
      <Intl>
        <Note state={makeState()} />
      </Intl>,
    );
    expect(screen.getByTestId('note').textContent).toContain(messages.finance.csvAssistant.columns.requiredItems.pendingValues);
    cleanup();
    render(
      <Intl>
        <Note state={makeState({ pendingValues: 'Ausstehend' })} />
      </Intl>,
    );
    expect(screen.getByTestId('note').textContent).toMatch(/4/);
    expect(screen.getByTestId('note').textContent).not.toContain(messages.finance.csvAssistant.columns.requiredItems.pendingValues);
  });
});

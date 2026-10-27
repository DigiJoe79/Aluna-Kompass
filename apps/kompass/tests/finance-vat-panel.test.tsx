// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { VatSettingsView } from '@kompass/module-finance';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import { EMPTY } from '@/components/empty-value';
import { VatPanel } from '@/app/(shell)/admin/finance/vat-panel';
import { removeVatSettingsAction, saveVatSettingsAction } from '@/app/(shell)/admin/finance/actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/(shell)/admin/finance/actions', () => ({
  saveVatSettingsAction: vi.fn(async () => ({ status: 'success', message: 'ok' })),
  removeVatSettingsAction: vi.fn(async () => ({ status: 'success', message: 'ok' })),
}));
afterEach(() => {
  cleanup();
  vi.mocked(saveVatSettingsAction).mockClear();
  vi.mocked(removeVatSettingsAction).mockClear();
});

const m = messages.finance.admin.vat;
const EFFECTIVE = { entrepreneur: true, vatId: 'DE136695976', advancePeriod: 'auto', permanentExtension: false } as const;

function view(over: Omit<Partial<VatSettingsView>, 'profile'> & { profile?: Partial<VatSettingsView['profile']> } = {}): VatSettingsView {
  const { profile, ...rest } = over;
  return {
    profile: { on: '2026-10-25', taxation: 'smallBusiness', entrepreneur: false, vatId: null, advancePeriod: 'auto', advanceExempt: false, permanentExtension: false, taxOfficeState: null, obligations: 'section18_4aLegalPerson', ...profile },
    hints: [],
    confirmedAt: null,
    entrepreneurDecided: false,
    taxationSince: null,
    advancePeriodKind: 'quarter',
    history: [],
    ...rest,
  };
}

function renderPanel(v: VatSettingsView, canEdit = true) {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <VatPanel view={v} today="2026-10-25" canEdit={canEdit} />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
  return screen.getByTestId('vat-panel');
}

const entrepreneurGroup = (panel: HTMLElement) => within(panel).getByRole('radiogroup', { name: m.entrepreneur.label });

/** Plan E6a Task 11b — Reiter „Umsatzsteuer“ (Board 1a, 1b). */
describe('VatPanel', () => {
  it('offers no preselection while nothing is decided', () => {
    const panel = renderPanel(view());
    for (const radio of within(entrepreneurGroup(panel)).getAllByRole('radio')) expect(radio.getAttribute('aria-checked')).toBe('false');
  });

  it('shows only the question when a small business answers no', () => {
    const panel = renderPanel(view());
    expect(within(panel).getByLabelText(m.vatId.label)).toBeTruthy();
    fireEvent.click(within(entrepreneurGroup(panel)).getByRole('radio', { name: m.yesNo.no }));
    expect(within(panel).queryByLabelText(m.vatId.label)).toBeNull();
    expect(within(panel).queryByRole('radiogroup', { name: m.permanentExtension.label })).toBeNull();
    expect(within(panel).queryByLabelText(m.taxOfficeState.label)).toBeNull();
  });

  it('keeps the VAT id field after no when the association has one (Befund 37)', async () => {
    const panel = renderPanel(view({ entrepreneurDecided: true, profile: { vatId: 'DE136695976' } }));
    const field = within(panel).getByLabelText(m.vatId.label);
    expect(within(panel).getByTestId('vat-not-entrepreneur')).toBeTruthy();
    expect(within(panel).queryByRole('radiogroup', { name: m.permanentExtension.label })).toBeNull();
    expect(field.getAttribute('aria-describedby')).toContain('vat-id-hint');
    expect(document.getElementById('vat-id-hint')!.textContent).toContain(m.vatId.notEntrepreneur);
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(within(panel).getByTestId('vat-settings-save'));
    await waitFor(() => expect(saveVatSettingsAction).toHaveBeenCalledWith({ validFrom: '2026-10-25', vatId: '' }));
  });

  it('offers the exemption only under regular taxation', () => {
    const small = renderPanel(view({ entrepreneurDecided: true, profile: { entrepreneur: true, obligations: 'section18_4a' } }));
    expect(within(small).queryByRole('radiogroup', { name: m.advanceExempt.label })).toBeNull();
    cleanup();
    const regular = renderPanel(view({ entrepreneurDecided: true, profile: { taxation: 'regular', entrepreneur: true, obligations: 'regular' } }));
    expect(within(regular).getByRole('radiogroup', { name: m.advanceExempt.label })).toBeTruthy();
  });

  it('saves the day and the changed fields only', async () => {
    const panel = renderPanel(view({ entrepreneurDecided: true, profile: { entrepreneur: true, obligations: 'section18_4a' } }));
    fireEvent.change(within(panel).getByLabelText(m.validFrom.label), { target: { value: '2026-07-01' } });
    fireEvent.click(within(panel).getByRole('radiogroup', { name: m.permanentExtension.label }).querySelector('[value="yes"]')!);
    fireEvent.click(within(panel).getByTestId('vat-settings-save'));
    await waitFor(() => expect(saveVatSettingsAction).toHaveBeenCalledWith({ validFrom: '2026-07-01', vatPermanentExtension: true }));
  });

  it('shows a refused VAT id at its field', async () => {
    vi.mocked(saveVatSettingsAction).mockResolvedValueOnce({ status: 'error', message: 'abgelehnt', fieldErrors: { vatId: messages.errors.fields.invalidVatId } });
    const panel = renderPanel(view({ entrepreneurDecided: true, profile: { entrepreneur: true, obligations: 'section18_4a' } }));
    const field = within(panel).getByLabelText(m.vatId.label);
    fireEvent.change(field, { target: { value: 'DE123456789' } });
    fireEvent.click(within(panel).getByTestId('vat-settings-save'));
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'));
    expect(document.getElementById(field.getAttribute('aria-describedby')!.split(' ').find((id) => id.endsWith('-error'))!)).toBeTruthy();
  });

  it('removes a stand after asking', async () => {
    const panel = renderPanel(view({ entrepreneurDecided: true, profile: { entrepreneur: true }, history: [{ validFrom: '2026-07-01', removal: { validFrom: '2026-07-01', nextFrom: null, finalizedEntries: 0 }, values: { vatPermanentExtension: true }, effective: { ...EFFECTIVE, permanentExtension: true } }, { validFrom: '2026-01-01', removal: { validFrom: '2026-01-01', nextFrom: '2026-07-01', finalizedEntries: 3 }, values: { vatEntrepreneur: true }, effective: EFFECTIVE }] }));
    const rows = within(panel).getAllByTestId('vat-history-row');
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows[1]!).getByRole('button'));
    fireEvent.click(await screen.findByRole('menuitem', { name: m.history.remove }));
    const dialog = await screen.findByRole('alertdialog');
    // N11 c: Die Rückfrage nennt die festgeschriebenen Buchungen, deren Lage sich ändert.
    expect(dialog.textContent).toMatch(/\b3\b/);
    fireEvent.click(within(dialog).getByRole('button', { name: m.history.removeConfirm }));
    await waitFor(() => expect(removeVatSettingsAction).toHaveBeenCalledWith('2026-01-01'));
  });

  it('writes out what a stand did not set, as the form shows it (Befund 30 g)', () => {
    const panel = renderPanel(view({ entrepreneurDecided: true, profile: { entrepreneur: true }, history: [{ validFrom: '2026-01-01', removal: { validFrom: '2026-01-01', nextFrom: null, finalizedEntries: 0 }, values: { vatEntrepreneur: true }, effective: EFFECTIVE }] }));
    const row = within(panel).getByTestId('vat-history-row');
    expect(within(row).getByText(m.advancePeriod.auto)).toBeTruthy();
    expect(within(row).queryByText(EMPTY)).toBeNull();
  });

  it('keeps the VAT ID of a „Nein“ stand, which still places EU services; period and extension are „—“ (Befund 37/E13)', () => {
    const notEntrepreneur = { ...EFFECTIVE, entrepreneur: false };
    const panel = renderPanel(view({ entrepreneurDecided: true, profile: { entrepreneur: false }, history: [{ validFrom: '2026-10-26', removal: { validFrom: '2026-10-26', nextFrom: null, finalizedEntries: 0 }, values: { vatEntrepreneur: false }, effective: notEntrepreneur }] }));
    const row = within(panel).getByTestId('vat-history-row');
    expect(within(row).getByText('DE136695976')).toBeTruthy();
    expect(within(row).queryByText(m.advancePeriod.auto)).toBeNull();
    expect(within(row).getAllByText(EMPTY)).toHaveLength(2);
  });

  it('reads only without the setup permission', () => {
    const panel = renderPanel(view({ history: [{ validFrom: '2026-01-01', removal: { validFrom: '2026-01-01', nextFrom: null, finalizedEntries: 0 }, values: { vatEntrepreneur: true }, effective: EFFECTIVE }] }), false);
    expect(within(panel).queryByTestId('vat-settings-save')).toBeNull();
    expect(within(within(panel).getByTestId('vat-history-row')).queryByRole('button')).toBeNull();
    expect(within(panel).getByLabelText(m.vatId.label).hasAttribute('disabled')).toBe(true);
  });
});

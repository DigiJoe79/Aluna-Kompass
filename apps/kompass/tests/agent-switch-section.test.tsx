// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import { MailSettingsPanel } from '@/app/(shell)/admin/dms/mail-settings-panel';
import { saveMailSettingsAction } from '@/app/(shell)/admin/dms/actions';
import { TaxPanel } from '@/app/(shell)/admin/finance/tax-panel';
import { setFinanceSwitchesAction } from '@/app/(shell)/admin/finance/actions';
import { NumbersPanel } from '@/app/(shell)/admin/members/numbers-panel';
import { saveMembersSettingsAction, setNextMemberNumberAction } from '@/app/(shell)/admin/members/actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@/app/(shell)/admin/finance/actions', () => ({
  applyTaxDefaultsAction: vi.fn(),
  setBoardRemunerationAction: vi.fn(),
  setExpenseWaiverBasisAction: vi.fn(),
  setFinanceLimitsAction: vi.fn(),
  setFinanceSwitchesAction: vi.fn(async () => ({ status: 'success', message: 'Schalter gespeichert.' })),
}));
vi.mock('@/app/(shell)/admin/members/actions', () => ({
  saveMembersSettingsAction: vi.fn(async () => ({ status: 'success', message: 'Gespeichert.' })),
  setNextMemberNumberAction: vi.fn(async () => ({ status: 'success' })),
}));
vi.mock('@/app/(shell)/admin/dms/actions', () => ({
  saveMailSettingsAction: vi.fn(async () => ({ status: 'success', message: 'Gespeichert.' })),
  sendTestMailAction: vi.fn(),
  setMailBodySnippetAction: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrap(children: ReactNode) {
  return render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">{children}</DateFormatProvider>
    </NextIntlClientProvider>,
  );
}

const FINANCE_LABEL = 'Darf ein Agent festschreiben und Lastschriften bearbeiten?';
const MEMBERS_LABEL = 'Darf ein Agent Mitglieder aufnehmen, Läufe starten und Briefe ausstellen?';
const DMS_LABEL = 'Darf ein Agent Dokumente per E-Mail senden?';

function renderTax(agent = false) {
  wrap(
    <TaxPanel
      switches={{ isEntrepreneurOrHasVatId: false, membershipFeesCertifiable: false, expenseWaiversEnabled: false, mcpHumanOnlyAllowed: agent }}
      limits={{ statementSufficesBelowCents: 30000, cashDonationAlertCents: 100000, roundAmountFromCents: 50000, proofGraceDays: 30 }}
      confirmedAt={null}
      waiverBasisText=""
      waiverBasisAgreedOn={null}
      boardRemuneration={{ allowed: false, basisText: '', validFrom: null, decidedOn: null }}
    />,
  );
  return screen.getByTestId('tax-switches');
}

function renderNumbers(canChangeAgent = true) {
  wrap(<NumbersPanel values={{ nextNumber: 7, noticeMonths: 3, noticeAt: 'fiscalYearEnd', paymentTermDays: 14, joinYearRule: 'full' }} agent={{ allowed: false, canChange: canChangeAgent }} />);
  return screen.getByTestId('numbers-panel');
}

function renderMail() {
  wrap(
    <MailSettingsPanel
      mail={{ kind: 'ready', host: 'smtp.example.org', redirectTo: null }}
      values={{ fromAddress: 'post@example.org', fromName: 'Beispielverein', replyTo: '', ratePerMinute: 20 }}
      types={[]}
      snippets={[]}
      byType={{}}
      defaultSnippetId={null}
      canManageSettings
      canSend
      agentAllowed={false}
    />,
  );
  return screen.getByTestId('mail-settings');
}

/**
 * Plan U4 Task 1 (Nachtrag MCP-Test § 1): Der Agentenschalter ist der Baustein `AgentSwitchSection` — der letzte
 * Abschnitt des Formulars vor der Speicherleiste. Er speichert mit dem Formular, nicht sofort; „Verwerfen“ setzt ihn
 * zurück.
 */
describe('AgentSwitchSection speichert mit dem Formular', () => {
  it('Finanzen › Steuerliches: der Schalter steht in der Karte der Schalter und geht mit deren Leiste', async () => {
    const card = renderTax();
    const toggle = within(card).getByRole('switch', { name: FINANCE_LABEL });
    expect(within(card).getByRole('heading', { name: 'Agent' })).toBeTruthy();
    fireEvent.click(toggle);
    expect(setFinanceSwitchesAction).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByTestId('tax-switches-save'));
    await waitFor(() => expect(setFinanceSwitchesAction).toHaveBeenCalledWith([{ key: 'finance.mcpHumanOnlyAllowed', value: true }]));
  });

  it('Finanzen: „Verwerfen“ setzt den Schalter zurück, nichts wird gespeichert', () => {
    const card = renderTax(true);
    const toggle = within(card).getByRole('switch', { name: FINANCE_LABEL });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(within(card).getByRole('button', { name: 'Verwerfen' }));
    expect(within(card).getByRole('switch', { name: FINANCE_LABEL }).getAttribute('aria-checked')).toBe('true');
    expect(setFinanceSwitchesAction).not.toHaveBeenCalled();
  });

  it('Mitglieder › Nummern und Fristen: der Schalter geht mit den übrigen Feldern an dieselbe Aktion', async () => {
    const card = renderNumbers();
    fireEvent.click(within(card).getByRole('switch', { name: MEMBERS_LABEL }));
    fireEvent.click(within(card).getByTestId('numbers-save'));
    await waitFor(() => expect(saveMembersSettingsAction).toHaveBeenCalledWith({ resignationNotice: { months: 3, at: 'fiscalYearEnd' }, paymentTermDays: 14, joinYearRule: 'full' }, 'numbers', true));
    expect(setNextMemberNumberAction).not.toHaveBeenCalled();
  });

  it('Mitglieder: ohne Änderung am Schalter geht kein Wert für ihn mit; ohne Recht ist er gesperrt', async () => {
    const card = renderNumbers(false);
    expect(within(card).getByRole('switch', { name: MEMBERS_LABEL }).hasAttribute('data-disabled')).toBe(true);
    fireEvent.change(within(card).getByLabelText('Zahlungsziel in Briefen'), { target: { value: '21' } });
    fireEvent.click(within(card).getByTestId('numbers-save'));
    await waitFor(() => expect(saveMembersSettingsAction).toHaveBeenCalledWith(expect.anything(), 'numbers', undefined));
  });

  it('Akte › Versand: der Schalter steht in der Karte „Absender“ und geht mit ihr', async () => {
    const card = renderMail();
    fireEvent.click(within(card).getByRole('switch', { name: DMS_LABEL }));
    fireEvent.click(within(card).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(saveMailSettingsAction).toHaveBeenCalledWith({ fromAddress: 'post@example.org', fromName: 'Beispielverein', replyTo: null, ratePerMinute: 20 }, true));
  });
});

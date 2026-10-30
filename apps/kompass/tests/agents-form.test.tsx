// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { AgentsForm } from '@/app/(shell)/admin/agents/agents-form';
import { saveAgentSwitchesAction } from '@/app/(shell)/admin/agents/actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@/app/(shell)/admin/agents/actions', () => ({ saveAgentSwitchesAction: vi.fn(async () => ({ status: 'success', message: 'Gespeichert.' })) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const texts = messages.admin.agents.switches;

function renderForm() {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <AgentsForm
        switches={[
          { key: 'finance.mcpHumanOnlyAllowed', value: false },
          { key: 'governance.mcpHumanOnlyAllowed', value: true },
        ]}
      />
    </NextIntlClientProvider>,
  );
  return screen.getByTestId('agent-switches');
}

/**
 * Verwaltung → Agenten (Spec 2026-10-29): je Schalter ein Abschnitt mit dem Modulnamen; gespeichert wird mit der
 * Leiste, und nur, was sich geändert hat. „Verwerfen“ setzt die Schalter zurück.
 */
describe('Seite Agenten', () => {
  it('zeigt je Schalter einen Abschnitt mit Modulnamen, Frage und Hinweis', () => {
    const card = renderForm();
    expect(within(card).getAllByRole('heading').map((h) => h.textContent)).toEqual([texts.finance.title, texts.governance.title]);
    expect(within(card).getByRole('switch', { name: texts.finance.label }).getAttribute('aria-checked')).toBe('false');
    expect(within(card).getByRole('switch', { name: texts.governance.label }).getAttribute('aria-checked')).toBe('true');
  });

  it('speichert nur den geänderten Schalter, nicht sofort, sondern mit der Leiste', async () => {
    const card = renderForm();
    fireEvent.click(within(card).getByRole('switch', { name: texts.finance.label }));
    expect(saveAgentSwitchesAction).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByTestId('agent-switches-save'));
    await waitFor(() => expect(saveAgentSwitchesAction).toHaveBeenCalledWith({ 'finance.mcpHumanOnlyAllowed': true }));
  });

  it('„Verwerfen“ setzt den Schalter zurück, nichts wird gespeichert', () => {
    const card = renderForm();
    fireEvent.click(within(card).getByRole('switch', { name: texts.governance.label }));
    expect(within(card).getByRole('switch', { name: texts.governance.label }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(within(card).getByRole('button', { name: 'Verwerfen' }));
    expect(within(card).getByRole('switch', { name: texts.governance.label }).getAttribute('aria-checked')).toBe('true');
    expect(saveAgentSwitchesAction).not.toHaveBeenCalled();
  });
});

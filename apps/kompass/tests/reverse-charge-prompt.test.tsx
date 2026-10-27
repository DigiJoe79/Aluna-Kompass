// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { ReverseChargePrompt } from '@/components/finance/reverse-charge-prompt';
import { applyReverseChargeYes, reverseChargeCheckInput, withoutReverseChargeSentences } from '@/lib/finance/reverse-charge-prompt';

afterEach(cleanup);

const Intl = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {children}
  </NextIntlClientProvider>
);
const m = messages.finance.reverseChargePrompt;
const contact = { id: 'C1', name: 'Zahlfix Test', country: 'LU' };

function show(props: Partial<Parameters<typeof ReverseChargePrompt>[0]> = {}) {
  const onYes = vi.fn();
  const onNo = vi.fn();
  render(<ReverseChargePrompt trigger="foreignNoTax" triggerText="Auslöser" contact={contact} onYes={onYes} onNo={onNo} {...props} />, { wrapper: Intl });
  return { onYes, onNo, group: screen.getByRole('group', { name: m.question }) };
}

/** Plan E6b Task 4 — Baustein `ReverseChargePrompt` (Board 7a/7b). */
describe('ReverseChargePrompt', () => {
  it('offers four reasons and needs text for other', () => {
    const { onNo, group } = show();
    fireEvent.click(within(group).getByRole('button', { name: m.no }));
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    fireEvent.click(within(group).getByRole('radio', { name: m.reasons.other }));
    fireEvent.click(within(group).getByRole('button', { name: m.save }));
    expect(onNo).not.toHaveBeenCalled();
    expect(within(group).getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(within(group).getByRole('textbox'), { target: { value: '  Messe  ' } });
    fireEvent.click(within(group).getByRole('button', { name: m.save }));
    expect(onNo).toHaveBeenCalledWith('other', 'Messe');
  });

  it('declines with a reason', () => {
    const { onNo, group } = show();
    fireEvent.click(within(group).getByRole('button', { name: m.no }));
    fireEvent.click(within(group).getByRole('radio', { name: m.reasons.paymentServices }));
    fireEvent.click(within(group).getByRole('button', { name: m.save }));
    expect(onNo).toHaveBeenCalledWith('paymentServices', undefined);
  });

  it('remembers yes at the contact unless unticked', () => {
    const { onYes, group } = show();
    const box = within(group).getByRole('checkbox');
    expect(box.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: m.yes }));
    expect(onYes).toHaveBeenLastCalledWith({ remember: true });
    fireEvent.click(box);
    fireEvent.click(within(group).getByRole('button', { name: m.yes }));
    expect(onYes).toHaveBeenLastCalledWith({ remember: false });
  });

  // Designer Runde 8, 9c: Das Kästchen gehört zum Ja — nach den Knöpfen, und weg, solange „Nein, weil …“ offen ist.
  it('shows the box after the buttons and drops it while declining', () => {
    const { group } = show();
    const order = [...group.querySelectorAll('button, [role="checkbox"]')].map((el) => el.getAttribute('role') ?? el.textContent);
    expect(order.indexOf('checkbox')).toBeGreaterThan(order.indexOf(m.no));
    fireEvent.click(within(group).getByRole('button', { name: m.no }));
    expect(within(group).queryByRole('checkbox')).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: m.no }));
    expect(within(group).getByRole('checkbox')).toBeTruthy();
  });

  it('has no box without a contact', () => {
    const { onYes, group } = show({ contact: null });
    expect(within(group).queryByRole('checkbox')).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: m.yes }));
    expect(onYes).toHaveBeenCalledWith({ remember: false });
  });

  it('stacks the buttons in the narrow layout', () => {
    const { group } = show({ layout: 'narrow', contact: null });
    const buttons = within(within(group).getByTestId('reverse-charge-buttons')).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([m.yes, m.no]);
  });
});

describe('Prüffrage in der Maske', () => {
  const rows = [
    { key: 'a', amountText: '120,00', taxCode: undefined as string | undefined, contactId: 'C1', taxCodeOrigin: null as 'contact' | 'prompt' | null },
    { key: 'b', amountText: '10,00', taxCode: undefined as string | undefined, contactId: null, taxCodeOrigin: null as 'contact' | 'prompt' | null },
  ];

  it('builds the check from the rows', () => {
    expect(reverseChargeCheckInput(rows, { expense: true, documentId: 'D1' })).toEqual({ contactId: 'C1', documentId: 'D1', rawTransactionId: null, lines: [{ amountCents: -12000, taxCode: null, categoryId: null }, { amountCents: -1000, taxCode: null, categoryId: null }] });
  });

  it('marks only the lines of the answer', () => {
    const next = applyReverseChargeYes(rows, { lineIndexes: [0], suggestedCode: 'rc13bEu' });
    expect(next[0]).toMatchObject({ taxCode: 'rc13bEu', taxCodeOrigin: 'prompt' });
    expect(next[1]).toEqual(rows[1]);
  });
});

describe('Hilfezeile der Kategorie bei offener Prüffrage', () => {
  it('lässt die Sätze zu § 13b weg und behält den Rest', () => {
    expect(withoutReverseChargeSentences('Rechnung aus dem Ausland ohne Umsatzsteuer? Dann ist es meist ein Fall des §\u00a013b.')).toBe('');
    expect(withoutReverseChargeSentences('Geschenke für Mitglieder. Kein § 13b. Hinweis für Zeile 74.')).toBe('Geschenke für Mitglieder. Hinweis für Zeile 74.');
    expect(withoutReverseChargeSentences('Brutto buchen.')).toBe('Brutto buchen.');
  });
});

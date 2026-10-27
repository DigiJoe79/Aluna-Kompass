// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/(shell)/contacts/search-action', () => ({ searchContactsAction: vi.fn(async () => []) }));
const { SplitRow } = await import('@/components/finance/split-row');
afterEach(cleanup);

const s = messages.finance.splitRow;
const categories = [
  { id: 'ads', name: 'Öffentlichkeitsarbeit', direction: 'expense' as const, sphere: 'ideal' },
  { id: 'gifts', name: 'Spenden', direction: 'income' as const, sphere: 'ideal' },
];
const codes = ['none', 'exemptCounted', 'exemptNotCounted', 'reduced', 'standard', 'rc13bEu', 'rc13bOther', 'icAcquisition'];
const context = { taxation: 'smallBusiness' as const, rates: { standard: 19, reduced: 7 }, periodKinds: { 2025: 'quarter' as const, 2026: 'quarter' as const, 2027: 'quarter' as const } };
const base = { key: 'r1', categoryId: 'ads', amountText: '200,00', contactId: null, projectId: null, purposeId: null, abroad: false, addsToAssets: false };
const show = (over: Record<string, unknown> = {}, onChange = vi.fn(), options: string[] = codes, defaultDirection?: 'income' | 'expense') => {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <SplitRow value={{ ...base, ...over }} onChange={onChange} onRemove={vi.fn()} onDuplicate={vi.fn()} onRestHere={vi.fn()} onSplitEvenly={vi.fn()} position={1} restCents={null} categories={categories} purposes={[]} projects={[]} taxCodeOptions={options} showTax vatContext={context} entryDate="2026-07-03" defaultDirection={defaultDirection} />
    </NextIntlClientProvider>,
  );
  return onChange;
};

/** Plan E6a Task 11c — Leistungsdatum, Herkunft und Gruppe der § 13b-Kennzeichen an der Buchungszeile (Board 3a). */
describe('Aufteilungszeile: § 13b und Erwerb', () => {
  it('shows the service date only for reverse-charge codes, as invoice date for the other cases', () => {
    show({ taxCode: 'standard' });
    expect(screen.queryByLabelText(s.serviceDate)).toBeNull();
    cleanup();
    show({ taxCode: 'rc13bEu' });
    expect(screen.getByLabelText(s.serviceDate)).toBeTruthy();
    cleanup();
    show({ taxCode: 'icAcquisition' });
    expect(screen.getByLabelText(s.serviceDate)).toBeTruthy();
    cleanup();
    show({ taxCode: 'rc13bOther' });
    expect(screen.queryByLabelText(s.serviceDate)).toBeNull();
    expect(screen.getByLabelText(s.invoiceDate)).toBeTruthy();
  });

  it('clears the service date and the origin when the code changes by hand', () => {
    const onChange = show({ taxCode: 'rc13bEu', serviceDate: '2026-06-30', taxCodeOrigin: 'contact' });
    fireEvent.change(screen.getByLabelText(s.tax), { target: { value: 'standard' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ taxCode: 'standard', serviceDate: null, taxCodeOrigin: null }));
  });

  it('names the origin only when the code came from the contact', () => {
    show({ taxCode: 'rc13bEu' });
    expect(screen.queryByText(s.taxOrigin.contact)).toBeNull();
    cleanup();
    show({ taxCode: 'rc13bEu', taxCodeOrigin: 'contact' });
    expect(screen.getByText(s.taxOrigin.contact)).toBeTruthy();
  });

  it('groups the three codes the association owes', () => {
    show({ taxCode: 'rc13bEu' });
    const group = (screen.getByLabelText(s.tax) as HTMLSelectElement).querySelector('optgroup')!;
    expect(group.getAttribute('label')).toBe(s.taxOwedGroup);
    expect([...group.querySelectorAll('option')].map((o) => o.value)).toEqual(['rc13bEu', 'rc13bOther', 'icAcquisition']);
  });

  it('keeps a code the options no longer offer selectable (Befund 37)', () => {
    show({ taxCode: 'rc13bEu' }, vi.fn(), ['rc13bOther', 'icAcquisition']);
    const select = screen.getByLabelText(s.tax) as HTMLSelectElement;
    expect(select.value).toBe('rc13bEu');
    expect([...select.querySelectorAll('optgroup option')].map((o) => (o as HTMLOptionElement).value)).toEqual(['rc13bOther', 'icAcquisition', 'rc13bEu']);
  });

  it('says the tax under the row', () => {
    show({ taxCode: 'rc13bEu', serviceDate: '2026-06-30' });
    expect(screen.getByTestId('split-row-vat-sentence').textContent).toContain('38,00');
    cleanup();
    show({ taxCode: 'standard' });
    expect(screen.queryByTestId('split-row-vat-sentence')).toBeNull();
  });

  it('shows the tax field without entrepreneur status only on expense lines, by category or else by the form (Befund 39)', () => {
    const purchases = ['rc13bOther', 'icAcquisition'];
    show({}, vi.fn(), purchases);
    expect(screen.getByLabelText(s.tax)).toBeTruthy();
    cleanup();
    show({ categoryId: 'gifts' }, vi.fn(), purchases);
    expect(screen.queryByLabelText(s.tax)).toBeNull();
    cleanup();
    show({ categoryId: '' }, vi.fn(), purchases, 'expense');
    expect(screen.getByLabelText(s.tax)).toBeTruthy();
    cleanup();
    show({ categoryId: '' }, vi.fn(), purchases, 'income');
    expect(screen.queryByLabelText(s.tax)).toBeNull();
    cleanup();
    // Ein schon gesetztes Kennzeichen verschwindet nicht still.
    show({ categoryId: 'gifts', taxCode: 'rc13bOther' }, vi.fn(), purchases);
    expect(screen.getByLabelText(s.tax)).toBeTruthy();
    cleanup();
    // Für Unternehmer bleibt die Spalte an jeder Zeile.
    show({ categoryId: 'gifts' });
    expect(screen.getByLabelText(s.tax)).toBeTruthy();
  });
});

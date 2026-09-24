import { describe, expect, it } from 'vitest';
import { toServiceInput } from '@/lib/finance/entry-form';
import { afterRemoval, formFromTransaction, miniFormFromSuggestion, miniFormRemainder, miniFormToBookInput, parseWorkTab, stepSelection, workHref } from '@/lib/finance/work';

const expenseRaw = { id: 'RAW1', accountId: 'bank', bookingDate: '2026-01-10', amountCents: -3500, counterpartyName: 'Buerobedarf Muster GmbH', purpose: 'Bueromaterial' };
const incomeRaw = { id: 'RAW2', accountId: 'bank', bookingDate: '2026-02-15', amountCents: 5000, counterpartyName: null, purpose: 'Zuschuss' };

const ruleDraft = {
  entryDate: '2026-01-10',
  text: 'Büromaterial',
  moneyLines: [{ accountId: 'bank', amountCents: -3500, rawTransactionId: 'RAW1' }],
  allocationLines: [{ categoryId: 'office', amountCents: -3500, contactId: 'C1' }],
};

describe('work list: tabs, links and selection', () => {
  it('reads the tab from the address and falls back to the first tab', () => {
    expect(parseWorkTab('agent')).toBe('agent');
    expect(parseWorkTab('nonsense')).toBe('open');
    expect(parseWorkTab(undefined)).toBe('open');
  });

  it('keeps tab, account and selection in the address, leaving out what is empty', () => {
    expect(workHref({ tab: 'open' })).toBe('/finance/work');
    expect(workHref({ tab: 'unsure', account: 'A1', raw: 'R1' })).toBe('/finance/work?tab=unsure&account=A1&raw=R1');
    expect(workHref({ tab: 'open', account: 'A1' })).toBe('/finance/work?account=A1');
  });

  it('moves the selection by one and stays at the ends', () => {
    const ids = ['a', 'b', 'c'];
    expect(stepSelection(ids, 'a', 1)).toBe('b');
    expect(stepSelection(ids, 'c', 1)).toBe('c');
    expect(stepSelection(ids, 'a', -1)).toBe('a');
    expect(stepSelection(ids, null, 1)).toBe('a');
    expect(stepSelection([], null, 1)).toBeNull();
  });

  it('jumps to the next item after the current one is gone, else to the previous one', () => {
    expect(afterRemoval(['a', 'b', 'c'], 'a')).toBe('b');
    expect(afterRemoval(['a', 'b', 'c'], 'c')).toBe('b');
    expect(afterRemoval(['a'], 'a')).toBeNull();
  });
});

describe('mini form of the work list', () => {
  it('shows an expense with positive amounts and books it with the sign of the transaction', () => {
    const form = miniFormFromSuggestion(expenseRaw, ruleDraft, new Map([['C1', 'Erika Beispiel']]));
    expect(form).toMatchObject({ entryDate: '2026-01-10', text: 'Büromaterial', sign: -1 });
    expect(form.rows).toEqual([expect.objectContaining({ categoryId: 'office', amountText: '35,00', contactId: 'C1', contactName: 'Erika Beispiel' })]);
    expect(miniFormRemainder(form)).toBe(0);

    const result = miniFormToBookInput(form, expenseRaw.id, ruleDraft);
    if (!result.ok) throw new Error('expected ok');
    expect(result.input).toEqual({
      rawTransactionId: 'RAW1', entryDate: '2026-01-10', text: 'Büromaterial', reviewed: true,
      allocationLines: [{ categoryId: 'office', amountCents: -3500, contactId: 'C1', projectId: null, purposeId: null, abroad: false }],
    });
  });

  it('carries the second money line of a transfer and the settlements of an open item into the booking', () => {
    const transfer = { entryDate: '2026-03-02', text: 'Umbuchung', moneyLines: [{ accountId: 'bank', amountCents: -50000, rawTransactionId: 'RAW3' }, { accountId: 'service', amountCents: 48500, rawTransactionId: 'RAW4' }], allocationLines: [{ categoryId: 'fees', amountCents: -1500 }] };
    const form = miniFormFromSuggestion({ ...expenseRaw, id: 'RAW3', amountCents: -50000 }, transfer, new Map());
    expect(form.rows[0]!.amountText).toBe('15,00');
    expect(miniFormRemainder(form)).toBe(0);
    const result = miniFormToBookInput(form, 'RAW3', transfer);
    if (!result.ok) throw new Error('expected ok');
    expect(result.input.extraMoneyLines).toEqual([{ accountId: 'service', amountCents: 48500, rawTransactionId: 'RAW4' }]);

    const settle = { entryDate: '2026-03-20', text: 'Rechnung', moneyLines: [{ accountId: 'bank', amountCents: -23800, rawTransactionId: 'RAW5', settlements: [{ openItemId: 'OI1', amountCents: 23800 }] }], allocationLines: [{ categoryId: 'program', amountCents: -23800 }] };
    const settled = miniFormToBookInput(miniFormFromSuggestion({ ...expenseRaw, id: 'RAW5', amountCents: -23800 }, settle, new Map()), 'RAW5', settle);
    if (!settled.ok) throw new Error('expected ok');
    expect(settled.input.settlements).toEqual([{ openItemId: 'OI1', amountCents: 23800 }]);
  });

  it('starts without a suggestion from the bank data: one row with the whole amount, text from counterparty and purpose', () => {
    const form = miniFormFromSuggestion(expenseRaw, null, new Map());
    expect(form.text).toBe('Buerobedarf Muster GmbH · Bueromaterial');
    expect(form.rows).toEqual([expect.objectContaining({ categoryId: '', amountText: '35,00' })]);
    expect(miniFormRemainder(form)).toBe(0);
    const result = miniFormToBookInput(form, expenseRaw.id, null);
    expect(result).toEqual({ ok: false, fieldErrors: { 'rows.0.categoryId': 'required' } });
  });

  it('reports what is still to be split while the rows do not add up', () => {
    const form = miniFormFromSuggestion(expenseRaw, ruleDraft, new Map());
    const half = { ...form, rows: [{ ...form.rows[0]!, amountText: '20,00' }] };
    expect(miniFormRemainder(half)).toBe(1500);
    expect(miniFormRemainder({ ...form, rows: [{ ...form.rows[0]!, amountText: 'x' }] })).toBeNull();
  });
});

describe('full entry form from a transaction (?raw=)', () => {
  it('prefills account, amount, direction and the bound transaction from the suggestion', () => {
    const form = formFromTransaction(expenseRaw, ruleDraft);
    expect(form).toMatchObject({ id: undefined, entryDate: '2026-01-10', text: 'Büromaterial', template: 'expense' });
    expect(form.moneyRows).toEqual([expect.objectContaining({ accountId: 'bank', amountText: '35,00', direction: 'out', rawTransactionId: 'RAW1', rawBookingDate: '2026-01-10' })]);
    expect(form.splitRows).toEqual([expect.objectContaining({ categoryId: 'office', amountText: '35,00', contactId: 'C1' })]);
    const input = toServiceInput(form);
    if (!input.ok) throw new Error('expected ok');
    expect(input.input.moneyLines).toEqual([{ accountId: 'bank', amountCents: -3500, rawTransactionId: 'RAW1', settlements: undefined }]);
  });

  it('prefills an income without a suggestion: bound money row, one row with the amount, text from the bank data', () => {
    const form = formFromTransaction(incomeRaw, null);
    expect(form).toMatchObject({ template: 'income', text: 'Zuschuss', entryDate: '2026-02-15' });
    expect(form.moneyRows).toEqual([expect.objectContaining({ accountId: 'bank', amountText: '50,00', direction: 'in', rawTransactionId: 'RAW2', rawBookingDate: '2026-02-15' })]);
    expect(form.splitRows).toEqual([expect.objectContaining({ categoryId: '', amountText: '50,00' })]);
  });
});

import { describe, expect, it } from 'vitest';
import { applyTemplate, emptyForm, fromEntryView, remainderCents, restInto, toServiceInput, type EntryFormState } from '@/lib/finance/entry-form';

const withSplitRow = (state: EntryFormState, key: string, categoryId: string, amountText: string): EntryFormState => ({
  ...state,
  splitRows: [...state.splitRows, { key, categoryId, amountText, contactId: null, projectId: null, purposeId: null, abroad: false, addsToAssets: false }],
});

describe('emptyForm / applyTemplate', () => {
  it('gives income and expense one money row with the right direction, no split rows', () => {
    const income = emptyForm('income', '2026-03-01');
    expect(income.moneyRows).toHaveLength(1);
    expect(income.moneyRows[0]!.direction).toBe('in');
    expect(income.splitRows).toEqual([]);

    const expense = emptyForm('expense', '2026-03-01');
    expect(expense.moneyRows[0]!.direction).toBe('out');
  });

  it('makes a transfer two money lines and no allocation line', () => {
    const state = applyTemplate(emptyForm('income', '2026-03-01'), 'transfer');
    expect(state.moneyRows.map((r) => r.direction)).toEqual(['out', 'in']);
    expect(state.splitRows).toEqual([]);
  });

  it('gives in-kind no money line and two coupled split rows, the second locked', () => {
    const state = applyTemplate(emptyForm('income', '2026-03-01'), 'inKind');
    expect(state.moneyRows).toEqual([]);
    expect(state.splitRows).toHaveLength(2);
    expect(state.splitRows[0]!.locked).toBeFalsy();
    expect(state.splitRows[1]!.locked).toBe(true);
  });

  it('couples the two in-kind rows: changing the first sets the second to the negative amount', () => {
    let state = applyTemplate(emptyForm('income', '2026-03-01'), 'inKind');
    state = { ...state, splitRows: state.splitRows.map((r, i) => (i === 0 ? { ...r, amountText: '250,00' } : r)) };
    // Die Oberflaeche ruft applyTemplate beim Tippen erneut auf, um die zweite Zeile nachzuziehen.
    state = applyTemplate(state, 'inKind');
    expect(state.splitRows[0]!.amountText).toBe('250,00');
    expect(state.splitRows[1]!.amountText).toBe('−250,00');
    expect(state.splitRows[1]!.locked).toBe(true);
  });
});

describe('remainderCents', () => {
  it('balances Prüfstein 1: one incoming 485,00 split into 200/200/100/−15', () => {
    let state = emptyForm('income', '2026-03-01');
    state = { ...state, text: 'Auszahlung Plattform', moneyRows: [{ ...state.moneyRows[0]!, accountId: 'bank', amountText: '485,00' }] };
    state = withSplitRow(state, 's1', 'donations', '200,00');
    state = withSplitRow(state, 's2', 'donations', '200,00');
    state = withSplitRow(state, 's3', 'donations', '100,00');
    state = withSplitRow(state, 's4', 'payment-fees', '−15,00');

    expect(remainderCents(state)).toBe(0);
    const result = toServiceInput(state);
    if (!result.ok) throw new Error('expected ok');
    expect(result.input.moneyLines).toEqual([{ accountId: 'bank', amountCents: 48500, settlements: undefined }]);
    expect(result.input.allocationLines.map((l) => l.amountCents)).toEqual([20000, 20000, 10000, -1500]);
  });

  it('reports „Noch 85,00 zu verteilen“ mid-work as a positive remainder', () => {
    let state = emptyForm('income', '2026-03-01');
    state = { ...state, moneyRows: [{ ...state.moneyRows[0]!, accountId: 'bank', amountText: '485,00' }] };
    state = withSplitRow(state, 's1', 'donations', '200,00');
    state = withSplitRow(state, 's2', 'donations', '200,00');

    expect(remainderCents(state)).toBe(8500);
  });

  it('negates expense amounts and round-trips through fromEntryView', () => {
    let state = emptyForm('expense', '2026-03-01');
    state = { ...state, text: 'Ausgabe', moneyRows: [{ ...state.moneyRows[0]!, accountId: 'bank', amountText: '60,00' }] };
    state = withSplitRow(state, 's1', 'program-costs', '60,00');

    expect(remainderCents(state)).toBe(0);
    const result = toServiceInput(state);
    if (!result.ok) throw new Error('expected ok');
    expect(result.input.moneyLines[0]!.amountCents).toBe(-6000);
    expect(result.input.allocationLines[0]!.amountCents).toBe(-6000);

    const roundTripped = fromEntryView({
      id: 'E1', entryDate: '2026-03-01', text: 'Ausgabe',
      moneyLines: [{ accountId: 'bank', amountCents: -6000 }],
      allocationLines: [{ categoryId: 'program-costs', amountCents: -6000 }],
    });
    expect(roundTripped.template).toBe('expense');
    expect(roundTripped.moneyRows[0]).toMatchObject({ accountId: 'bank', direction: 'out', amountText: '60,00' });
    expect(roundTripped.splitRows[0]).toMatchObject({ categoryId: 'program-costs', amountText: '60,00' });
    const backToService = toServiceInput(roundTripped);
    if (!backToService.ok) throw new Error('expected ok');
    expect(backToService.input.moneyLines[0]!.amountCents).toBe(-6000);
    expect(backToService.input.allocationLines[0]!.amountCents).toBe(-6000);
  });

  it('puts the rest into the chosen row', () => {
    let state = emptyForm('income', '2026-03-01');
    state = { ...state, moneyRows: [{ ...state.moneyRows[0]!, accountId: 'bank', amountText: '485,00' }] };
    state = withSplitRow(state, 's1', 'donations', '200,00');
    state = withSplitRow(state, 's2', 'donations', '200,00');
    state = withSplitRow(state, 's3', 'donations', '');

    const filled = restInto(state, 's3');
    expect(filled.splitRows.find((r) => r.key === 's3')!.amountText).toBe('85,00');
    expect(remainderCents(filled)).toBe(0);
  });
});

describe('fromEntryView: guesses the template', () => {
  it('guesses transfer when there are no allocation lines', () => {
    const state = fromEntryView({ id: 'E1', entryDate: '2026-03-01', text: 'Umbuchung', moneyLines: [{ accountId: 'bank', amountCents: -5000 }, { accountId: 'cash', amountCents: 5000 }], allocationLines: [] });
    expect(state.template).toBe('transfer');
  });

  it('guesses in-kind when there are no money lines', () => {
    const state = fromEntryView({ id: 'E1', entryDate: '2026-03-01', text: 'Sachspende', moneyLines: [], allocationLines: [{ categoryId: 'in-kind-donations', amountCents: 5000 }, { categoryId: 'program-in-kind', amountCents: -5000 }] });
    expect(state.template).toBe('inKind');
  });

  it('guesses income when the money sum is not negative', () => {
    const state = fromEntryView({ id: 'E1', entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: 'bank', amountCents: 5000 }], allocationLines: [{ categoryId: 'donations', amountCents: 5000 }] });
    expect(state.template).toBe('income');
  });
});

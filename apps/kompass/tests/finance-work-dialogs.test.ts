import { describe, expect, it } from 'vitest';
import { batchAccountState, ruleConditionParts, ruleFormFromRule, ruleFormFromTransaction, ruleFormToInput, rulePreviewInput } from '@/lib/finance/work-dialogs';
import { miniFormFromSuggestion } from '@/lib/finance/work';

const raw = { id: 'RAW1', accountId: 'bank', bookingDate: '2026-08-03', amountCents: -4800, counterpartyName: 'Futterhaus Beispiel KG', counterpartyIban: 'DE69 9999 9999 0000 4455 66', purpose: 'Futter Juli' };

describe('rule dialog („Künftig immer so?“)', () => {
  it('fills the condition from the transaction and the result from the mini form', () => {
    const mini = miniFormFromSuggestion(raw, { entryDate: '2026-08-03', text: 'Futter', moneyLines: [{ accountId: 'bank', amountCents: -4800, rawTransactionId: 'RAW1' }], allocationLines: [{ categoryId: 'program', amountCents: -4800, projectId: 'P1', contactId: 'C1' }] }, new Map([['C1', 'Futterhaus']]));
    expect(ruleFormFromTransaction(raw, mini)).toEqual({
      name: 'Futterhaus Beispiel KG', accountId: 'bank', direction: 'out', ibanOn: true, iban: 'DE69 9999 9999 0000 4455 66', textContains: 'Futterhaus Beispiel KG', amountMinText: '', amountMaxText: '',
      categoryId: 'program', projectId: 'P1', purposeId: null, contactId: 'C1', contactName: 'Futterhaus', taxCode: '', entryText: 'Futter', isActive: true,
    });
  });

  it('starts without iban and without category when the transaction and the mini form have none', () => {
    const form = ruleFormFromTransaction({ ...raw, amountCents: 2000, counterpartyName: null, counterpartyIban: null }, null);
    expect(form).toMatchObject({ name: 'Futter Juli', direction: 'in', ibanOn: false, iban: '', textContains: '', categoryId: '', entryText: '' });
  });

  it('turns the form into the service input: unchecked iban and empty fields are no condition, amounts in cents', () => {
    const form = { ...ruleFormFromTransaction(raw, null), categoryId: 'program', ibanOn: false, amountMinText: '40,00', amountMaxText: '' };
    expect(ruleFormToInput(form)).toEqual({
      ok: true,
      input: { name: 'Futterhaus Beispiel KG', isActive: true, accountId: 'bank', direction: 'out', counterpartyIban: null, textContains: 'Futterhaus Beispiel KG', amountMinCents: 4000, amountMaxCents: null, categoryId: 'program', projectId: null, purposeId: null, contactId: null, taxCode: null, entryText: null },
    });
    expect(ruleFormToInput({ ...form, id: 'R1', ibanOn: true })).toMatchObject({ ok: true, input: { id: 'R1', counterpartyIban: 'DE69 9999 9999 0000 4455 66' } });
  });

  it('names the fields it cannot read — the rest the service checks', () => {
    const form = { ...ruleFormFromTransaction(raw, null), name: ' ', amountMinText: 'viel' };
    expect(ruleFormToInput(form)).toEqual({ ok: false, fieldErrors: { name: 'required', categoryId: 'required', amountMinCents: 'format' } });
  });

  it('previews only once a category and a condition are there', () => {
    const form = ruleFormFromTransaction(raw, null);
    expect(rulePreviewInput(form)).toBeNull();
    expect(rulePreviewInput({ ...form, categoryId: 'program' })).toEqual({ accountId: 'bank', direction: 'out', counterpartyIban: 'DE69 9999 9999 0000 4455 66', textContains: 'Futterhaus Beispiel KG', amountMinCents: null, amountMaxCents: null, categoryId: 'program' });
    expect(rulePreviewInput({ ...form, categoryId: 'program', accountId: '', direction: '', ibanOn: false, textContains: '' })).toBeNull();
    expect(rulePreviewInput({ ...form, categoryId: 'program', amountMinText: 'x' })).toBeNull();
  });

  it('opens a saved rule for editing with its values', () => {
    const rule = { id: 'R1', name: 'Büromaterial', isActive: true, accountId: null, direction: null, counterpartyIban: null, textContains: 'bueromaterial', amountMinCents: 1000, amountMaxCents: 5000, categoryId: 'office', projectId: null, purposeId: null, contactId: null, taxCode: null, entryText: 'Büromaterial' };
    expect(ruleFormFromRule(rule)).toEqual({
      id: 'R1', name: 'Büromaterial', accountId: '', direction: '', ibanOn: false, iban: '', textContains: 'bueromaterial', amountMinText: '10,00', amountMaxText: '50,00',
      categoryId: 'office', projectId: null, purposeId: null, contactId: null, contactName: null, taxCode: '', entryText: 'Büromaterial', isActive: true,
    });
  });

  it('lists the conditions of a rule as parts for the rules page', () => {
    const rule = { accountId: 'bank', direction: 'out' as const, counterpartyIban: 'DE69999999990000445566', textContains: 'futter', amountMinCents: 1000, amountMaxCents: null };
    expect(ruleConditionParts(rule, new Map([['bank', 'Importkonto']]))).toEqual([
      { key: 'account', values: { account: 'Importkonto' } },
      { key: 'out', values: {} },
      { key: 'iban', values: { iban: 'DE69999999990000445566' } },
      { key: 'text', values: { text: 'futter' } },
      { key: 'amountFrom', values: { amount: '10,00 €' } },
    ]);
    expect(ruleConditionParts({ accountId: null, direction: 'in', counterpartyIban: null, textContains: null, amountMinCents: 1000, amountMaxCents: 2000 }, new Map())).toEqual([
      { key: 'in', values: {} },
      { key: 'amountBetween', values: { min: '10,00 €', max: '20,00 €' } },
    ]);
    expect(ruleConditionParts({ accountId: null, direction: null, counterpartyIban: null, textContains: null, amountMinCents: null, amountMaxCents: 900 }, new Map())).toEqual([{ key: 'amountUpTo', values: { amount: '9,00 €' } }]);
  });
});

describe('batch finalize preview (Sammel-Festschreiben)', () => {
  const row = { accountId: 'A', accountName: 'Importkonto', kind: 'bank', sumCents: -3500, bookCentsNow: 120000, bookCentsAfter: 116500, statementClosingCents: 151000, statementDate: '2026-07-31', matches: false };
  it('compares the book balance after with the statement, or says why it cannot', () => {
    expect(batchAccountState(row)).toEqual({ state: 'differs', differenceCents: -34500 });
    expect(batchAccountState({ ...row, statementClosingCents: 116500, matches: true })).toEqual({ state: 'matches', differenceCents: 0 });
    expect(batchAccountState({ ...row, statementClosingCents: null, statementDate: null, matches: null })).toEqual({ state: 'noStatement', differenceCents: null });
    expect(batchAccountState({ ...row, kind: 'cash', statementClosingCents: null, statementDate: null, matches: null })).toEqual({ state: 'cash', differenceCents: null });
  });
});

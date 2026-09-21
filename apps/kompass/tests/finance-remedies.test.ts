import { describe, expect, it } from 'vitest';
import { remediesFor } from '@/lib/finance/remedies';

describe('remediesFor', () => {
  it('gives cashWouldGoNegative two ways out and entryUnbalanced one action', () => {
    expect(remediesFor('entryUnbalanced')).toEqual([{ kind: 'action', action: 'restIntoLastRow', labelKey: 'finance.remedy.restIntoLastRow' }]);
    expect(remediesFor('cashWouldGoNegative')).toEqual([
      { kind: 'action', action: 'focusDate', labelKey: 'finance.remedy.focusDate' },
      { kind: 'link', href: '/finance/entries/new?template=transfer', labelKey: 'finance.remedy.cashTransferFirst' },
    ]);
  });

  it('returns nothing for an unknown code', () => {
    expect(remediesFor('somethingUnknown')).toEqual([]);
  });

  it('offers a way out for the three import refusals (F4 Task 7)', () => {
    expect(remediesFor('statementIbanMismatch')).toEqual([{ kind: 'action', action: 'focusAccount', labelKey: 'finance.remedy.chooseOtherAccount' }]);
    expect(remediesFor('statementAlreadyImported')).toEqual([{ kind: 'link', href: '/finance/imports#runs', labelKey: 'finance.remedy.goToExistingRun' }]);
    expect(remediesFor('statementFormatChange')).toEqual([{ kind: 'action', action: 'confirmFormatChange', labelKey: 'finance.remedy.confirmFormatChange' }]);
  });
});

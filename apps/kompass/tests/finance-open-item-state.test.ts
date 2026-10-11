import { describe, expect, it } from 'vitest';
import { openItemState } from '@/lib/finance/open-item-state';

describe('openItemState', () => {
  it('names the four state words and overdue only while something is open', () => {
    expect(openItemState({ amountCents: 5000, openCents: 5000, cancelledAt: null, dueOn: '2026-03-01' }, '2026-03-10')).toEqual({ word: 'open', overdue: true });
    expect(openItemState({ amountCents: 5000, openCents: 5000, cancelledAt: null, dueOn: '2026-03-20' }, '2026-03-10')).toEqual({ word: 'open', overdue: false });
    expect(openItemState({ amountCents: 5000, openCents: 2000, cancelledAt: null, dueOn: '2026-03-01' }, '2026-03-10')).toEqual({ word: 'partlyPaid', overdue: true });
    expect(openItemState({ amountCents: 5000, openCents: 0, cancelledAt: null, dueOn: '2026-03-01' }, '2026-03-10')).toEqual({ word: 'settled', overdue: false });
    expect(openItemState({ amountCents: 5000, openCents: 5000, cancelledAt: '2026-03-05T10:00:00.000Z', dueOn: '2026-03-01' }, '2026-03-10')).toEqual({ word: 'settledWithoutPayment', overdue: false });
    expect(openItemState({ amountCents: 5000, openCents: 5000, cancelledAt: null, dueOn: null }, '2026-03-10')).toEqual({ word: 'open', overdue: false });
  });
});


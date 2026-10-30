import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { RESERVE_KINDS as MODULE_KINDS } from '@kompass/module-finance';
import { reserveBalanceAfter, RESERVE_KINDS, reserveSaveBlocker } from '@/lib/finance/reserves';

describe('reserve dialog arithmetic (F8b Task 6b, Design 4d)', () => {
  it('adds an allocation, subtracts a withdrawal and empties on dissolve', () => {
    expect(reserveBalanceAfter(10000, 'allocate', 2500)).toBe(12500);
    expect(reserveBalanceAfter(10000, 'withdraw', 2500)).toBe(7500);
    expect(reserveBalanceAfter(10000, 'dissolve', null)).toBe(0);
  });

  it('treats a missing amount as nothing yet', () => {
    expect(reserveBalanceAfter(10000, 'allocate', null)).toBe(10000);
  });

  it('offers the kinds of the module in its order — the two operation reserves last (Plan U2 Task 6)', () => {
    expect(RESERVE_KINDS).toEqual(MODULE_KINDS);
    expect(RESERVE_KINDS.slice(-2)).toEqual(['business', 'assetManagement']);
  });
});

/** Runde 3, 124/125: Der gesperrte Knopf nennt, was noch fehlt — das erste in der Reihenfolge der Felder. */
describe('was dem Vorgang noch fehlt', () => {
  it('nennt Betrag, Datum und Beschluss in der Reihenfolge der Maske', () => {
    expect(reserveSaveBlocker({ amountOk: false, date: '', documents: 0 })).toBe('amount');
    expect(reserveSaveBlocker({ amountOk: true, date: '', documents: 0 })).toBe('date');
    expect(reserveSaveBlocker({ amountOk: true, date: '2026-03-01', documents: 0 })).toBe('resolution');
    expect(reserveSaveBlocker({ amountOk: true, date: '2026-03-01', documents: 2 })).toBe('resolutionTwice');
    expect(reserveSaveBlocker({ amountOk: true, date: '2026-03-01', documents: 1 })).toBeNull();
  });

  it('hat für jeden Grund einen Satz', () => {
    const missing = (messages.finance.reserves as unknown as { missing: Record<string, string> }).missing;
    expect(Object.keys(missing).sort()).toEqual(['amount', 'date', 'resolution', 'resolutionTwice']);
  });
});

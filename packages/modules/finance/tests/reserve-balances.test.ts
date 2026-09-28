import { describe, expect, it } from 'vitest';
import { latestMovementDate, reserveBalanceAt, reserveBalancesAt, reserveIsDissolved } from '../src/ledger/reserve-balances';
import { setupFinance } from './helpers';
import { insertReserve, insertReserveMovement } from './mittel-fixture';

describe('reserveBalanceAt (F8b Annahme 3) — pure', () => {
  it('starts from the carry-forward as of its own date and adds allocations, subtracts withdrawals and dissolutions', () => {
    const reserve = { carryForwardCents: 1000, carryForwardDate: '2026-02-01' };
    const movements = [
      { kind: 'allocate' as const, movementDate: '2026-02-10', amountCents: 500 },
      { kind: 'withdraw' as const, movementDate: '2026-02-20', amountCents: 300 },
    ];
    expect(reserveBalanceAt(reserve, [], '2026-01-15')).toBe(0);
    expect(reserveBalanceAt(reserve, movements, '2026-02-05')).toBe(1000);
    expect(reserveBalanceAt(reserve, movements, '2026-02-10')).toBe(1500);
    expect(reserveBalanceAt(reserve, movements, '2026-02-20')).toBe(1200);
  });

  it('goes to zero after a dissolution, which is stored as the exact remainder', () => {
    const reserve = { carryForwardCents: null, carryForwardDate: null };
    const movements = [
      { kind: 'allocate' as const, movementDate: '2026-02-10', amountCents: 500 },
      { kind: 'dissolve' as const, movementDate: '2026-03-01', amountCents: 500 },
    ];
    expect(reserveBalanceAt(reserve, movements, '2026-03-01')).toBe(0);
  });
});

describe('reserveBalancesAt, latestMovementDate, reserveIsDissolved — query', () => {
  it('reads every reserve, even one without a movement', () => {
    const { deps } = setupFinance();
    const id = insertReserve(deps.db, { carryForwardCents: 2000, carryForwardDate: '2026-01-01' });
    expect(reserveBalancesAt(deps.db, '2026-06-01')).toEqual([{ reserveId: id, balanceCents: 2000 }]);
    expect(latestMovementDate(deps.db, id)).toBeNull();
    expect(reserveIsDissolved(deps.db, id)).toBe(false);
  });

  it('finds the latest movement date and whether the reserve is dissolved', () => {
    const { deps } = setupFinance();
    const id = insertReserve(deps.db);
    insertReserveMovement(deps.db, id, { movementDate: '2026-02-01', amountCents: 1000 });
    insertReserveMovement(deps.db, id, { movementDate: '2026-03-01', amountCents: 400, kind: 'withdraw' });
    expect(latestMovementDate(deps.db, id)).toBe('2026-03-01');
    expect(reserveIsDissolved(deps.db, id)).toBe(false);
    insertReserveMovement(deps.db, id, { movementDate: '2026-04-01', amountCents: 600, kind: 'dissolve' });
    expect(reserveIsDissolved(deps.db, id)).toBe(true);
  });
});

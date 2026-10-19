import { registeredOpenItemOrigins } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { periodLabel } from '../src/fee-period';
import { membersRecordLabels } from '../src/record-labels';
import { memberFeeCharges, memberMemberships } from '../src/schema';
import { setupMembers } from './helpers';

// Plan M3, Task 1: Schema der Beiträge, Herkunft `memberFeeCharge`.
describe('fee schema', () => {
  it('registers the origin memberFeeCharge for the module members', () => {
    const { deps } = setupMembers();
    expect(registeredOpenItemOrigins(deps).get('memberFeeCharge')).toBe('members');
  });

  it('keeps one charge per membership and period start, except replaced ones', () => {
    const { deps } = setupMembers();
    const now = '2026-09-05T10:00:00.000Z';
    deps.db.insert(memberMemberships).values({ id: 'M1', contactId: 'C1', createdAt: now, updatedAt: now }).run();
    const charge = (id: string, state: 'created' | 'replaced') =>
      deps.db.insert(memberFeeCharges).values({ id, membershipId: 'M1', periodStart: '2027-01-01', periodEnd: '2027-12-31', amountCents: 1200, dueOn: '2027-01-01', state }).run();
    charge('F1', 'replaced');
    charge('F2', 'created');
    expect(() => charge('F3', 'created')).toThrow();
    expect(() => charge('F4', 'replaced')).not.toThrow();
  });

  it('labels a period as the payment reference names it', () => {
    expect(periodLabel('2027-01-01', '2027-12-31')).toBe('2027');
    expect(periodLabel('2027-07-01', '2027-12-31')).toBe('2027 H2');
    expect(periodLabel('2027-01-01', '2027-06-30')).toBe('2027 H1');
    expect(periodLabel('2027-04-01', '2027-06-30')).toBe('2027 Q2');
    expect(periodLabel('2027-03-01', '2027-03-31')).toBe('2027-03');
    // Rhythmus mitten im Zeitraum gewechselt (fee-calc): kein Halbjahr, kein Quartal.
    expect(periodLabel('2027-04-01', '2027-12-31')).toBe('2027-04/12');
    expect(periodLabel('2027-05-01', '2027-06-30')).toBe('2027-05/06');
  });

  it('labels a charge as origin of an open item: period and member number, link to the membership', () => {
    const { deps, ctx } = setupMembers();
    const now = '2026-09-05T10:00:00.000Z';
    deps.db.insert(memberMemberships).values({ id: 'M1', contactId: 'C1', memberNumber: '0007', createdAt: now, updatedAt: now }).run();
    deps.db.insert(memberFeeCharges).values({ id: 'F1', membershipId: 'M1', periodStart: '2027-01-01', periodEnd: '2027-12-31', amountCents: 1200, dueOn: '2027-01-01', state: 'created' }).run();
    expect(membersRecordLabels(deps, ctx, 'memberFeeCharge', 'F1')).toMatchObject({ label: { key: 'members.records.feeCharge', params: { period: '2027', memberNumber: '0007' } }, href: '/members/M1', state: 'ok' });
    expect(membersRecordLabels(deps, { ...ctx, permissions: new Set() }, 'memberFeeCharge', 'F1')).toMatchObject({ state: 'forbidden' });
    expect(membersRecordLabels(deps, ctx, 'memberFeeCharge', 'nope')).toMatchObject({ state: 'missing' });
  });
});

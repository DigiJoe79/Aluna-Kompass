import { describe, expect, it } from 'vitest';
import { pledgeDueDates, pledgeRates, type RatePledge } from '../src/direct-debit/rates';

const pledge = (over: Partial<RatePledge> = {}): RatePledge => ({ amountCents: 1000, interval: 'monthly', firstDueOn: '2026-01-15', lastDueOn: null, endedOn: null, pausedFrom: null, pausedUntil: null, ...over });
const none = { marks: [], runItems: [], bookedLines: [] };
const window = { from: '2026-01-01', to: '2026-12-31' };

/** Plan L1 Task 5 — Raten sind berechnet, keine offenen Posten (Nachtrag Phase 2). */
describe('pledgeRates', () => {
  it('monthly from 15 January to the end of the year are twelve expected rates', () => {
    const rates = pledgeRates(pledge(), { ...window, ...none });
    expect(rates).toHaveLength(12);
    expect(rates[0]).toEqual({ dueOn: '2026-01-15', amountCents: 1000, state: 'expected' });
    expect(rates.at(-1)!.dueOn).toBe('2026-12-15');
  });

  it('quarterly, half-yearly and yearly follow the first rate; the 31st falls back to the last day of a shorter month', () => {
    expect(pledgeDueDates(pledge({ interval: 'quarterly', firstDueOn: '2026-02-01' }), window.from, window.to)).toEqual(['2026-02-01', '2026-05-01', '2026-08-01', '2026-11-01']);
    expect(pledgeDueDates(pledge({ interval: 'halfYearly', firstDueOn: '2025-03-01' }), window.from, window.to)).toEqual(['2026-03-01', '2026-09-01']);
    expect(pledgeDueDates(pledge({ interval: 'yearly', firstDueOn: '2024-06-30' }), window.from, window.to)).toEqual(['2026-06-30']);
    expect(pledgeDueDates(pledge({ firstDueOn: '2026-01-31' }), '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('rates while the pledge rests are skipped, not expected (Review Focus 4)', () => {
    const rates = pledgeRates(pledge({ pausedFrom: '2026-04-01', pausedUntil: '2026-06-30' }), { ...window, ...none });
    expect(rates.filter((r) => r.state === 'skipped').map((r) => r.dueOn)).toEqual(['2026-04-15', '2026-05-15', '2026-06-15']);
    expect(rates.filter((r) => r.state === 'expected')).toHaveLength(9);
  });

  it('an end before the next rate cuts the list; so does the last rate', () => {
    expect(pledgeDueDates(pledge({ endedOn: '2026-05-10' }), window.from, window.to).at(-1)).toBe('2026-04-15');
    expect(pledgeDueDates(pledge({ endedOn: '2026-05-15' }), window.from, window.to).at(-1)).toBe('2026-05-15');
    expect(pledgeDueDates(pledge({ lastDueOn: '2026-03-15' }), window.from, window.to)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('takes skip marks, run items and booked lines from its sources (filled from L2/L3 on)', () => {
    const rates = pledgeRates(pledge(), {
      from: '2026-01-01',
      to: '2026-05-31',
      marks: [{ dueOn: '2026-02-15', mark: 'skipped' }],
      runItems: [{ dueOn: '2026-03-15', state: 'inRun' }],
      returns: [{ dueOn: '2026-04-15', resolution: null }],
      bookedLines: [{ dueOn: '2026-01-15', entryId: 'E1', entryNumber: '2026-0007' }],
    });
    expect(rates.map((r) => r.state)).toEqual(['booked', 'skipped', 'inRun', 'returned', 'expected']);
    expect(rates[0]).toEqual({ dueOn: '2026-01-15', amountCents: 1000, state: 'booked', entryId: 'E1', entryNumber: '2026-0007' });
  });

  it('Plan L3: a resolved return changes the state — recollect stays returned (will be collected again), by transfer expected again; a new run item wins', () => {
    const base = { from: '2026-01-01', to: '2026-03-31', marks: [], bookedLines: [] };
    const states = (returns: { dueOn: string; resolution: 'recollect' | 'requestTransfer' | 'waive' | null }[], runItems: { dueOn: string; state: 'inRun' }[] = []) =>
      pledgeRates(pledge(), { ...base, runItems, returns }).map(({ dueOn, state, recollect, transfer }) => ({ dueOn, state, recollect, transfer }));
    expect(states([{ dueOn: '2026-01-15', resolution: 'recollect' }, { dueOn: '2026-02-15', resolution: 'requestTransfer' }])).toEqual([
      { dueOn: '2026-01-15', state: 'returned', recollect: true, transfer: undefined },
      { dueOn: '2026-02-15', state: 'expected', recollect: undefined, transfer: true },
      { dueOn: '2026-03-15', state: 'expected', recollect: undefined, transfer: undefined },
    ]);
    expect(states([{ dueOn: '2026-01-15', resolution: 'recollect' }], [{ dueOn: '2026-01-15', state: 'inRun' }])[0]).toMatchObject({ state: 'inRun' });
  });
});

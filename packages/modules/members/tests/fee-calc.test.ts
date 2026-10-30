import { describe, expect, it } from 'vitest';
import { computeCharges, splitAroundKept, type ComputeChargesInput } from '../src/fee-calc';
import type { FeeInterval } from '../src/schema';

// Plan M3, Task 3: welche Beiträge in einem Jahr anfallen — rein, ohne Datenbank.
const regular = { typeId: 'regular', exempt: false };
const honorary = { typeId: 'honorary', exempt: true };
const supporting = { typeId: 'supporting', exempt: false };

function input(over: Partial<ComputeChargesInput> & { interval?: FeeInterval; amountCents?: number } = {}): ComputeChargesInput {
  const { interval = 'yearly', amountCents = 1200, ...rest } = over;
  return { year: 2027, joinedOn: '2020-01-01', endsOn: null, typeAt: () => regular, feeAt: () => ({ amountCents, interval }), joinYearRule: 'full', ...rest };
}
const rows = (i: ComputeChargesInput) => computeCharges(i).map((c) => [c.periodStart, c.periodEnd, c.amountCents, c.dueOn, c.skip ?? null]);

describe('computeCharges', () => {
  it('yearly, a whole year: one charge due on 1 January', () => {
    expect(rows(input())).toEqual([['2027-01-01', '2027-12-31', 1200, '2027-01-01', null]]);
  });

  it('monthly, a whole year: twelve charges', () => {
    const charges = computeCharges(input({ interval: 'monthly', amountCents: 1000 }));
    expect(charges).toHaveLength(12);
    expect(charges[1]).toEqual({ periodStart: '2027-02-01', periodEnd: '2027-02-28', amountCents: 1000, dueOn: '2027-02-01' });
    expect(charges.at(-1)!.periodEnd).toBe('2027-12-31');
  });

  it('joined on 15 August, yearly, full: the whole year, due on joining', () => {
    expect(rows(input({ joinedOn: '2027-08-15' }))).toEqual([['2027-01-01', '2027-12-31', 1200, '2027-08-15', null]]);
  });

  it('joined on 15 August, yearly, pro rata: five of twelve months', () => {
    expect(rows(input({ joinedOn: '2027-08-15', joinYearRule: 'proRataMonths' }))).toEqual([['2027-01-01', '2027-12-31', 500, '2027-08-15', null]]);
  });

  it('joined on 15 August, monthly, full: August to December, never before', () => {
    expect(rows(input({ joinedOn: '2027-08-15', interval: 'monthly', amountCents: 1000 }))).toEqual([
      ['2027-08-01', '2027-08-31', 1000, '2027-08-15', null],
      ['2027-09-01', '2027-09-30', 1000, '2027-09-01', null],
      ['2027-10-01', '2027-10-31', 1000, '2027-10-01', null],
      ['2027-11-01', '2027-11-30', 1000, '2027-11-01', null],
      ['2027-12-01', '2027-12-31', 1000, '2027-12-01', null],
    ]);
  });

  it('joined in the year, next year rule: nothing in the joining year, the full next year', () => {
    expect(computeCharges(input({ joinedOn: '2027-08-15', joinYearRule: 'nextYear' }))).toEqual([]);
    expect(rows(input({ joinedOn: '2026-08-15', joinYearRule: 'nextYear' }))).toEqual([['2027-01-01', '2027-12-31', 1200, '2027-01-01', null]]);
  });

  it('no charge for a year before joining or after the end', () => {
    expect(computeCharges(input({ joinedOn: '2028-01-01' }))).toEqual([]);
    expect(computeCharges(input({ endsOn: '2026-12-31' }))).toEqual([]);
  });

  it('ends on 31 March, monthly: January to March', () => {
    expect(computeCharges(input({ endsOn: '2027-03-31', interval: 'monthly' })).map((c) => c.periodStart)).toEqual(['2027-01-01', '2027-02-01', '2027-03-01']);
  });

  it('a period that begins before the end stays whole', () => {
    expect(rows(input({ endsOn: '2027-03-31' }))).toEqual([['2027-01-01', '2027-12-31', 1200, '2027-01-01', null]]);
  });

  it('type change on 1 July, half-yearly: first half after the old type, second after the new', () => {
    const i = input({
      typeAt: (day) => (day < '2027-07-01' ? regular : supporting),
      feeAt: (typeId) => (typeId === 'regular' ? { amountCents: 600, interval: 'halfYearly' } : { amountCents: 3000, interval: 'halfYearly' }),
    });
    expect(rows(i)).toEqual([
      ['2027-01-01', '2027-06-30', 600, '2027-01-01', null],
      ['2027-07-01', '2027-12-31', 3000, '2027-07-01', null],
    ]);
  });

  it('honorary member: one exempt line; a type without rule: one noRule line', () => {
    expect(rows(input({ typeAt: () => honorary }))).toEqual([['2027-01-01', '2027-12-31', 0, '2027-01-01', 'exempt']]);
    expect(rows(input({ feeAt: () => null }))).toEqual([['2027-01-01', '2027-12-31', 0, '2027-01-01', 'noRule']]);
  });

  it('rounds commercially to the cent: 10,00 € for seven of twelve months is 583 cents', () => {
    expect(computeCharges(input({ amountCents: 1000, joinedOn: '2027-06-10', joinYearRule: 'proRataMonths' }))[0]!.amountCents).toBe(583);
  });

  it('quarterly: four charges labelled by their quarter start', () => {
    expect(computeCharges(input({ interval: 'quarterly', amountCents: 300 })).map((c) => [c.periodStart, c.periodEnd])).toEqual([
      ['2027-01-01', '2027-03-31'],
      ['2027-04-01', '2027-06-30'],
      ['2027-07-01', '2027-09-30'],
      ['2027-10-01', '2027-12-31'],
    ]);
  });
});

describe('splitAroundKept (Plan R1, M2)', () => {
  const year = { periodStart: '2027-07-01', periodEnd: '2027-12-31', amountCents: 600, dueOn: '2027-07-01' };
  const rate = { amountCents: 1200, interval: 'yearly' as const };
  it('keeps the months no kept fee covers, each piece pro rata and due at its start', () => {
    expect(splitAroundKept(year, [], rate)).toEqual([year]);
    expect(splitAroundKept(year, [{ periodStart: '2027-07-01', periodEnd: '2027-07-31' }], rate)).toEqual([{ periodStart: '2027-08-01', periodEnd: '2027-12-31', amountCents: 500, dueOn: '2027-08-01' }]);
    expect(splitAroundKept(year, [{ periodStart: '2027-08-01', periodEnd: '2027-08-31' }], rate)).toEqual([
      { periodStart: '2027-07-01', periodEnd: '2027-07-31', amountCents: 100, dueOn: '2027-07-01' },
      { periodStart: '2027-09-01', periodEnd: '2027-12-31', amountCents: 400, dueOn: '2027-09-01' },
    ]);
    expect(splitAroundKept(year, [{ periodStart: '2027-01-01', periodEnd: '2027-12-31' }], rate)).toEqual([]);
    expect(splitAroundKept(year, [{ periodStart: '2027-07-01', periodEnd: '2027-07-31' }], null)).toEqual([]);
  });
});

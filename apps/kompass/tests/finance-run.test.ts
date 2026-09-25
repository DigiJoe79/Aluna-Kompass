import type { RunPreviewItem } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { groupRunItems, missingDonors, numberRangeText, parseRunQuery, runIssueCount, runProgress, runQueryString, runStep } from '@/lib/finance/run';

const item = (over: Partial<RunPreviewItem> = {}): RunPreviewItem => ({
  contactId: 'C1',
  contactName: 'Erika Beispiel',
  kind: 'collective',
  inKindLineId: null,
  lineIds: ['L1'],
  totalCents: 5000,
  lineCount: 1,
  alreadyConfirmedSingly: 0,
  group: 'ready',
  blockedBy: null,
  signatureReason: null,
  ...over,
});

const early = (over: Partial<RunPreviewItem> = {}) => item({ group: 'blocked', blockedBy: 'afterExemptionStart', ...over });

describe('Serienlauf in der Oberfläche (F6b Task 7)', () => {
  describe('groupRunItems', () => {
    it('orders the groups ready · needs signature · address missing · blocked and leaves out empty ones — before the start of the exemption is blocked', () => {
      const items = [
        item({ contactId: 'A', group: 'addressMissing', blockedBy: 'contactComplete' }),
        item({ contactId: 'B', group: 'blocked', blockedBy: 'documented' }),
        early({ contactId: 'C' }),
        item({ contactId: 'D', group: 'needsSignature', signatureReason: 'expenseWaiver' }),
        item({ contactId: 'E' }),
      ];
      expect(groupRunItems(items).map((g) => [g.key, g.items.map((i) => i.contactId)])).toEqual([
        ['ready', ['E']],
        ['needsSignature', ['D']],
        ['addressMissing', ['A']],
        ['blocked', ['B', 'C']],
      ]);
      expect(groupRunItems([item()]).map((g) => g.key)).toEqual(['ready']);
      expect(groupRunItems([])).toEqual([]);
    });
  });

  describe('runIssueCount', () => {
    it('counts the number range — blocked items, those before the start of the exemption among them, never', () => {
      const preview = { numberRange: { from: 'ZWB-2026-004', count: 3 }, items: [item(), early({ contactId: 'X' }), early({ contactId: 'Y' })] };
      expect(runIssueCount(preview)).toBe(3);
    });
  });

  describe('numberRangeText', () => {
    it('names the first and the last number, keeping the width of the counter', () => {
      expect(numberRangeText('ZWB-2026-004', 44)).toEqual({ from: 'ZWB-2026-004', to: 'ZWB-2026-047' });
      expect(numberRangeText('ZWB-2026-098', 5)).toEqual({ from: 'ZWB-2026-098', to: 'ZWB-2026-102' });
    });

    it('names one number alone and nothing for none', () => {
      expect(numberRangeText('ZWB-2026-006', 1)).toEqual({ from: 'ZWB-2026-006', to: null });
      expect(numberRangeText('ZWB-2026-006', 0)).toBeNull();
    });

    it('stays silent on a number without a counter at the end', () => {
      expect(numberRangeText('ZWB', 3)).toEqual({ from: 'ZWB', to: null });
    });
  });

  describe('runStep', () => {
    it('is selection without a year, preview with one, run while items are open, result once finished', () => {
      expect(runStep({ year: null, run: null })).toBe('selection');
      expect(runStep({ year: 2026, run: null })).toBe('preview');
      expect(runStep({ year: null, run: { finishedAt: null } })).toBe('run');
      expect(runStep({ year: 2026, run: { finishedAt: '2026-09-25T10:00:00.000Z' } })).toBe('result');
    });
  });

  describe('parseRunQuery / runQueryString', () => {
    it('reads year, minimum, excluded contacts, follow-up and run from the address and ignores junk', () => {
      expect(parseRunQuery({ year: '2025', min: '2000', exclude: 'A,B,,A', followUp: 'R1' })).toEqual({ year: 2025, minCents: 2000, excluded: ['A', 'B'], followUp: 'R1', runId: null });
      expect(parseRunQuery({ run: 'R2' })).toEqual({ year: null, minCents: null, excluded: [], followUp: null, runId: 'R2' });
      expect(parseRunQuery({ year: 'x', min: '-5' })).toEqual({ year: null, minCents: null, excluded: [], followUp: null, runId: null });
    });

    it('writes only what is set, so a reload shows the same preview', () => {
      expect(runQueryString({ year: 2025, minCents: 2000, excluded: ['A', 'B'], followUp: 'R1' })).toBe('?year=2025&min=2000&exclude=A%2CB&followUp=R1');
      expect(runQueryString({ year: 2026, minCents: null, excluded: [], followUp: null })).toBe('?year=2026');
      expect(parseRunQuery(Object.fromEntries(new URLSearchParams(runQueryString({ year: 2025, minCents: 0, excluded: ['A'], followUp: null }))))).toMatchObject({ year: 2025, minCents: 0, excluded: ['A'] });
    });
  });

  describe('missingDonors', () => {
    it('counts each donor once, whatever blocks them, in name order', () => {
      const items = [
        item({ contactId: 'A', contactName: 'Tobias Adler', group: 'addressMissing', blockedBy: 'contactComplete' }),
        item({ contactId: 'B', contactName: 'Clara Neumann', kind: 'inKind', group: 'blocked', blockedBy: 'inKindDetails' }),
        item({ contactId: 'B', contactName: 'Clara Neumann', kind: 'collective' }),
      ];
      expect(missingDonors(items)).toEqual({ count: 2, names: ['Clara Neumann', 'Tobias Adler'] });
      expect(missingDonors([])).toEqual({ count: 0, names: [] });
    });
  });

  describe('runProgress', () => {
    it('counts issued and failed items against everything that was to be issued — skipped ones are not work', () => {
      expect(runProgress({ total: 7, pending: 2, issued: 1, failed: 1, skipped: 3 })).toEqual({ done: 2, total: 4 });
      expect(runProgress({ total: 3, pending: 0, issued: 3, failed: 0, skipped: 0 })).toEqual({ done: 3, total: 3 });
    });
  });
});

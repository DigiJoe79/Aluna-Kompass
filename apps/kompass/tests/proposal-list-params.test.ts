import { describe, expect, it } from 'vitest';
import { proposalListInput, proposalQueryString } from '@/app/(shell)/animals/proposals/list-params';

describe('proposal list params', () => {
  it('defaults to open and reads kind, source and text', () => {
    expect(proposalListInput({})).toEqual({ state: 'open' });
    expect(proposalListInput({ kind: 'update', source: 'U1', text: '  Bruno ', state: 'rejected' })).toEqual({ state: 'rejected', kind: 'update', sourceUserId: 'U1', text: 'Bruno' });
  });
  it('skips unknown values and cuts the text to 80 characters', () => {
    expect(proposalListInput({ kind: 'foo', state: 'bar' })).toEqual({ state: 'open' });
    expect(proposalListInput({ text: 'x'.repeat(100) }).text).toHaveLength(80);
  });
  it('builds a query string from known, non-empty keys; open is the default and drops out', () => {
    expect(proposalQueryString({ text: 'Bruno', kind: '', state: 'open', other: 'x' })).toBe('text=Bruno');
    expect(proposalQueryString({ kind: 'create', source: 'U1', state: 'all' })).toBe('kind=create&source=U1&state=all');
  });
});

import { describe, expect, it } from 'vitest';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { ledgerFixture } from './helpers';

describe('finance MCP tools', () => {
  it('every human-only tool says so, and answers an agent with the way out', async () => {
    const f = await ledgerFixture();
    const humanOnly = ['finance_entry_review', 'finance_entry_finalize', 'finance_entries_finalize_reviewed', 'finance_entry_book', 'finance_entry_reverse'];
    for (const name of humanOnly) expect(FINANCE_MCP_TOOLS.find((t) => t.name === name)!.description, name).toMatch(/Human only/);
    const BALANCED = { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] };
    const res = await FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_entry_book')!.handler(f.deps, { ...f.ctx, channel: 'mcp' }, BALANCED);
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
  });
});

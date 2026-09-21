import { describe, expect, it } from 'vitest';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { ledgerFixture } from './helpers';

describe('finance MCP tools', () => {
  it('every human-only tool says so, and answers an agent with the way out', async () => {
    const f = await ledgerFixture();
    const humanOnly = ['finance_entry_review', 'finance_entry_finalize', 'finance_entries_finalize_reviewed', 'finance_entry_book', 'finance_entry_reverse', 'finance_voucher_revoke', 'finance_correction_request', 'finance_correction_decide'];
    for (const name of humanOnly) expect(FINANCE_MCP_TOOLS.find((t) => t.name === name)!.description, name).toMatch(/Human only/);

    const agent = { ...f.ctx, channel: 'mcp' as const };
    const BALANCED = { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] };
    const res = await FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_entry_book')!.handler(f.deps, agent, BALANCED);
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });

    const revokeRes = await FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_voucher_revoke')!.handler(f.deps, agent, { linkId: 'x', note: 'x' });
    expect(revokeRes).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });

    const requestRes = await FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_correction_request')!.handler(f.deps, agent, { lineId: 'x', changes: {}, note: 'x' });
    expect(requestRes).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });

    const decideRes = await FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_correction_decide')!.handler(f.deps, agent, { id: 'x', decision: 'approve' });
    expect(decideRes).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
  });

  it('registers nine new tools for vouchers, open items and the allocation correction', () => {
    const names = [
      'finance_voucher_upload', 'finance_voucher_attach', 'finance_voucher_revoke',
      'finance_open_item_save', 'finance_open_item_cancel', 'finance_open_items_list',
      'finance_correction_request', 'finance_correction_decide', 'finance_corrections_list',
    ];
    for (const name of names) expect(FINANCE_MCP_TOOLS.some((t) => t.name === name), name).toBe(true);
  });

  it('finance_voucher_upload rejects a file over the association’s upload limit', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalEntry();
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_voucher_upload')!;
    // Vorgabe finance.uploadLimitMb = 5 MB; 6 MB Rohdaten (roh, vor Base64) liegen darüber.
    const big = Buffer.alloc(6 * 1024 * 1024, 65).toString('base64');
    const res = await tool.handler(f.deps, f.ctx, { entryId: entry.id, contentBase64: big, typeKey: 'voucher-invoice', documentDate: '2026-03-01' });
    expect(res).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

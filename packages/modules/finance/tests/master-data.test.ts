import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { deleteMasterData, readMasterData, saveMasterData, setMasterDataActive } from '../src/ledger/master-data';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { setupFinance } from './helpers';

describe('master data over one door', () => {
  it('creates, changes, deactivates and deletes by kind — and leaves the permission check to the service behind it', async () => {
    const { deps, ctx } = setupFinance();
    const denied = await saveMasterData(deps, ctxWith(['finance.read']), { kind: 'purpose', data: { name: 'Dach' } });
    expect(denied.ok ? null : denied.error).toEqual({ type: 'forbidden', permission: 'finance.setup' });
    const purpose = unwrap(await saveMasterData(deps, ctx, { kind: 'purpose', data: { name: 'Dach' } })) as { id: string; updatedAt: string };
    unwrap(await saveMasterData(deps, ctx, { kind: 'purpose', data: { id: purpose.id, name: 'Dach neu', expectedVersion: purpose.updatedAt } }));
    unwrap(await setMasterDataActive(deps, ctx, { kind: 'purpose', id: purpose.id, isActive: false }));
    expect(unwrap(await readMasterData(deps, ctx, { kind: 'purpose' }))).toEqual([]);
    expect(unwrap(await readMasterData(deps, ctx, { kind: 'purpose', includeInactive: true }))).toHaveLength(1);
    unwrap(await deleteMasterData(deps, ctx, { kind: 'purpose', id: purpose.id }));
  });

  it('refuses a kind it does not know', async () => {
    const { deps, ctx } = setupFinance();
    expect((await readMasterData(deps, ctx, { kind: 'entry' })).ok).toBe(false);
  });

  it('every tool names its permission and is described in English', () => {
    for (const tool of FINANCE_MCP_TOOLS) expect(tool.description, tool.name).toMatch(/Requires finance\.(setup|overview|read)/);
    expect(FINANCE_MCP_TOOLS.map((t) => t.name)).toEqual(['finance_master_data', 'finance_master_data_save', 'finance_master_data_set_active', 'finance_master_data_delete', 'finance_fiscal_year_create_first', 'finance_fiscal_year_update', 'finance_purpose_close', 'finance_dated_value_set', 'finance_dated_value_remove']);
  });
});

import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { GOVERNANCE_MCP_TOOLS } from '../src/mcp-tools';
import { governanceRecordLabels } from '../src/record-labels';
import { governanceRecordReferences } from '../src/record-references';
import { asMcp, receivedDocument, setupGovernance } from './helpers';
import { chairResigns } from './register-helpers';

const tool = (name: string) => GOVERNANCE_MCP_TOOLS.find((t) => t.name === name)!;
const G5 = [
  'governance_register_occasions',
  'governance_register_filings_list',
  'governance_register_filing_get',
  'governance_register_filing_create',
  'governance_register_filing_add_occasions',
  'governance_register_filing_update',
  'governance_register_interim_order',
  'governance_register_interim_resolve',
  'governance_register_documents_set',
  'governance_register_requirements',
  'governance_register_transparency_save',
  'governance_register_filing_complete',
  'governance_register_dissolution_save',
];

describe('MCP tools of G5', () => {
  it('every tool of the plan exists and calls its service', () => {
    for (const name of G5) expect(tool(name)?.service, name).toBeTypeOf('function');
  });

  it('an agent bundles, notes the notary and submission, records an interim order; registration is refused over MCP', async () => {
    const { deps, ctx } = setupGovernance();
    const mcp = asMcp(ctx);
    const occasionId = await chairResigns(deps, ctx);
    expect(unwrap(await tool('governance_register_occasions').handler(deps, mcp, {}))).toHaveLength(1);
    const filing = unwrap(await tool('governance_register_filing_create').handler(deps, mcp, { occasions: [{ id: occasionId }] })) as { id: string };
    unwrap(await tool('governance_register_filing_update').handler(deps, mcp, { id: filing.id, notarizedOn: '2026-06-02', submittedOn: '2026-06-03' }));
    const documentId = await receivedDocument(deps, 'Zwischenverfügung');
    expect(unwrap(await tool('governance_register_interim_order').handler(deps, mcp, { filingId: filing.id, on: '2026-08-17', documentId }))).toMatchObject({ state: 'interimOrder' });
    expect(unwrap(await tool('governance_register_requirements').handler(deps, mcp, { filingId: filing.id }))).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'resolutionCopy' })]));
    expect(await tool('governance_register_filing_complete').handler(deps, mcp, { filingId: filing.id, registeredOn: '2026-09-01' })).toMatchObject({ ok: false, error: { code: 'humanOnly' } });

    expect(governanceRecordReferences(deps, 'document', documentId)).toEqual([expect.objectContaining({ entity: 'governanceRegisterFiling', id: filing.id })]);
    expect(governanceRecordLabels(deps, ctx, 'governanceRegisterFiling', filing.id)).toMatchObject({ state: 'ok', label: { key: 'governance.records.registerFiling', params: { date: '2026-05-31' } } });
  });
});

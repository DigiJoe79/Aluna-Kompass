import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { GOVERNANCE_MCP_TOOLS } from '../src/mcp-tools';
import { governanceOffices, governanceOrgans } from '../src/schema';
import { asMcp, person, setupGovernance } from './helpers';

const tool = (name: string) => GOVERNANCE_MCP_TOOLS.find((t) => t.name === name)!;

describe('governance tools', () => {
  it('brings the planned tools, each naming its permission', () => {
    expect(GOVERNANCE_MCP_TOOLS.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'governance_organs_list',
        'governance_organ_save',
        'governance_organ_set_active',
        'governance_office_save',
        'governance_office_set_active',
        'governance_terms_list',
        'governance_term_start',
        'governance_term_end',
        'governance_roles_adopt',
        'governance_statutes_list',
        'governance_statute_get',
        'governance_statute_create_draft',
        'governance_statute_update',
        'governance_statute_register',
        'governance_statute_delete_draft',
        'governance_rules_on',
      ]),
    );
    for (const t of GOVERNANCE_MCP_TOOLS) expect(t.description, t.name).toMatch(/governance\.(read|manage|record)/);
    expect(tool('governance_statute_register').description).toContain('Human only');
  });

  it('every tool calls its service', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-10-01T08:00:00.000Z' });
    const mcp = asMcp(ctx);
    const organs = unwrap(await tool('governance_organs_list').handler(deps, mcp, {})) as { id: string; kind: string }[];
    expect(organs).toHaveLength(2);
    const other = unwrap(await tool('governance_organ_save').handler(deps, mcp, { kind: 'other', name: 'Beirat' })) as { id: string };
    expect(await tool('governance_organ_set_active').handler(deps, mcp, { id: other.id, active: false })).toMatchObject({ ok: true });
    const board = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'board')!;
    const office = unwrap(
      await tool('governance_office_save').handler(deps, mcp, { organId: board.id, name: 'Beisitz', seats: 2, representative: false, termMonths: null, untilSuccessor: false, function: 'board', incompatibleWith: [] }),
    ) as { id: string };
    expect(await tool('governance_office_set_active').handler(deps, mcp, { id: office.id, active: false })).toMatchObject({ ok: true });
    const chair = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'chair')!;
    const term = unwrap(await tool('governance_term_start').handler(deps, mcp, { officeId: chair.id, contactId: await person(deps), since: '2026-07-20', origin: 'backfilled' })) as { id: string };
    expect(await tool('governance_terms_list').handler(deps, mcp, { officeId: chair.id })).toMatchObject({ ok: true, value: [{ id: term.id }] });
    expect(await tool('governance_term_end').handler(deps, mcp, { id: term.id, until: '2026-09-30', reason: 'other' })).toMatchObject({ ok: true });
    expect(await tool('governance_roles_adopt').handler(deps, mcp, { items: [{ rowId: 'nope', officeId: chair.id }] })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    const draft = unwrap(await tool('governance_statute_create_draft').handler(deps, mcp, {})) as { id: string };
    expect(await tool('governance_statute_update').handler(deps, mcp, { id: draft.id, note: 'Entwurf' })).toMatchObject({ ok: true });
    expect(await tool('governance_statute_get').handler(deps, mcp, { id: draft.id })).toMatchObject({ ok: true, value: { state: 'draft' } });
    expect(await tool('governance_statutes_list').handler(deps, mcp, {})).toMatchObject({ ok: true });
    expect(await tool('governance_rules_on').handler(deps, mcp, { on: '2026-09-01' })).toMatchObject({ ok: true, value: { statuteId: null } });
    expect(await tool('governance_statute_delete_draft').handler(deps, mcp, { id: draft.id })).toMatchObject({ ok: true });
  });

  it('refuses governance_statute_register over MCP', async () => {
    const { deps, ctx } = setupGovernance();
    const draft = unwrap(await tool('governance_statute_create_draft').handler(deps, ctx, {})) as { id: string };
    unwrap(await tool('governance_statute_update').handler(deps, ctx, { id: draft.id, resolutions: [{ on: '2026-07-20', resolutionId: null }] }));
    expect(await tool('governance_statute_register').handler(deps, asMcp(ctx), { id: draft.id, registeredOn: '2026-08-01' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
  });
});

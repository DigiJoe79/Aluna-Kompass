import { describe, expect, it } from 'vitest';
import { MEMBERS_MCP_TOOLS } from '../src/mcp-tools';
import { recordApplication } from '../src/memberships';
import { memberTypes } from '../src/schema';
import { asMcp, person, setupFees, setupMembers } from './helpers';

const tool = (name: string) => MEMBERS_MCP_TOOLS.find((t) => t.name === name)!;

describe('members tools', () => {
  it('says which tools are human only', () => {
    for (const name of ['members_admit', 'members_reject', 'members_delete', 'members_fee_run_start', 'members_fee_run_continue', 'members_fee_defer', 'members_fee_waive', 'members_letter_issue', 'members_count_certificate', 'members_dunning_run_start', 'members_dunning_run_continue', 'members_run_send_mails']) expect(tool(name).description).toContain('members.mcpHumanOnlyAllowed');
  });

  it('members_admit over MCP is refused as human only', async () => {
    const { deps, ctx } = setupMembers();
    const typeId = deps.db.select().from(memberTypes).all()[0]!.id;
    const app = await recordApplication(deps, ctx, { contactId: await person(deps), typeId, appliedOn: '2026-03-01' });
    const res = await tool('members_admit').handler(deps, asMcp(ctx), { membershipId: app.ok ? app.value.id : '', admittedOn: '2026-03-15' });
    expect(res.ok ? null : res.error).toMatchObject({ type: 'conflict', code: 'humanOnly' });
  });

  it('members_get and members_for_contact pass the id through', async () => {
    const { deps, ctx } = setupMembers();
    const typeId = deps.db.select().from(memberTypes).all()[0]!.id;
    const contactId = await person(deps);
    const app = await recordApplication(deps, ctx, { contactId, typeId, appliedOn: '2026-03-01' });
    const id = app.ok ? app.value.id : '';
    expect(await tool('members_get').handler(deps, ctx, { id })).toMatchObject({ ok: true, value: { id } });
    expect(await tool('members_for_contact').handler(deps, ctx, { contactId })).toMatchObject({ ok: true, value: { id } });
  });

  it('members_fee_run_start over MCP is refused as human only; the preview is open to agents', async () => {
    const { deps, ctx } = await setupFees({ now: '2027-02-10T08:00:00.000Z' });
    expect(await tool('members_fee_run_start').handler(deps, asMcp(ctx), { year: 2027 })).toMatchObject({ ok: false, error: { code: 'humanOnly' } });
    expect(await tool('members_fee_run_preview').handler(deps, asMcp(ctx), { year: 2027 })).toMatchObject({ ok: true, value: { year: 2027, items: [] } });
    expect(await tool('members_fees_for_member').handler(deps, ctx, { membershipId: 'nope' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });
});


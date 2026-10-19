import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { membersModule } from '../src/manifest';
import { MEMBERS_MCP_TOOLS } from '../src/mcp-tools';
import { recordApplication } from '../src/memberships';
import { memberTypes } from '../src/schema';
import { asMcp, person, setupFees, setupMembers } from './helpers';

const tool = (name: string) => MEMBERS_MCP_TOOLS.find((t) => t.name === name)!;

describe('members tools', () => {
  it('brings the agreed tools, each naming a service', () => {
    expect(MEMBERS_MCP_TOOLS.map((t) => t.name).sort()).toEqual(
      [
        'members_types_list', 'members_type_save', 'members_type_set_active', 'members_types_reorder', 'members_type_delete', 'members_settings_get', 'members_settings_save', 'members_overview', 'members_fee_detail', 'members_admission_preview', 'members_set_next_number',
        'members_list', 'members_get', 'members_for_contact', 'members_export', 'members_count_at',
        'members_create', 'members_apply', 'members_admit', 'members_reject', 'members_change_type', 'members_resign', 'members_end', 'members_revoke_end', 'members_delete',
        'members_fee_schedules_list', 'members_fee_schedule_save', 'members_fee_schedule_delete', 'members_fee_agreement_set',
        'members_fee_run_preview', 'members_fee_run_start', 'members_fee_run_continue', 'members_fee_runs_list', 'members_fee_run_get', 'members_fee_recalc_preview',
        'members_fees_list', 'members_fees_for_member', 'members_fee_defer', 'members_fee_waive',
        'members_letter_issue', 'members_count_certificate', 'members_dunning_preview', 'members_dunning_run_start', 'members_dunning_run_continue', 'members_dunning_runs_list', 'members_dunning_run_get',
        'members_run_dispatch_state', 'members_run_send_mails', 'members_run_mark_post', 'members_run_move',
      ].sort(),
    );
    for (const t of MEMBERS_MCP_TOOLS) expect(typeof t.service, t.name).toBe('function');
    expect(membersModule.mcpTools).toBe(MEMBERS_MCP_TOOLS);
  });

  it('names a tool for every permission, and the human-only tools say so', () => {
    for (const permission of membersModule.permissions) expect(MEMBERS_MCP_TOOLS.some((t) => t.description.includes(permission)), permission).toBe(true);
    for (const name of ['members_admit', 'members_reject', 'members_delete', 'members_fee_run_start', 'members_fee_run_continue', 'members_fee_defer', 'members_fee_waive', 'members_letter_issue', 'members_count_certificate', 'members_dunning_run_start', 'members_dunning_run_continue', 'members_run_send_mails']) expect(tool(name).description).toContain('members.mcpHumanOnlyAllowed');
  });

  it('shows a real object schema for every tool', () => {
    for (const t of MEMBERS_MCP_TOOLS) {
      const json = z.toJSONSchema(t.inputSchema as z.ZodType, { io: 'input' }) as { type?: string; properties?: object; required?: unknown };
      expect(json.type, t.name).toBe('object');
      expect(json.properties, t.name).toBeDefined();
      if (json.required !== undefined) expect(Array.isArray(json.required), t.name).toBe(true);
    }
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


import { coreModule, createRegistry, setModuleEnabled } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { financeModule } from '@kompass/module-finance';
import { projectsModule } from '@kompass/module-projects';
import { describe, expect, it } from 'vitest';
import { membersModule } from '../src/manifest';
import { admitMember, endMembership, recordApplication } from '../src/memberships';
import { memberTypes } from '../src/schema';
import { MEMBERS_SETTINGS } from '../src/settings';
import { asMcp, person, setupMembers } from './helpers';

describe('members manifest', () => {
  // Dass jede Vorgabe zu ihrem Schema passt, prüft `apps/kompass/tests/module-contracts.test.ts` für alle Module.
  it('bounds the number format and knows the notice periods', () => {
    const byKey = new Map(MEMBERS_SETTINGS.map((s) => [s.key, s]));
    expect(byKey.get('members.mcpHumanOnlyAllowed')).toMatchObject({ uiOnly: true });
    expect(byKey.get('members.numberFormat')!.schema.safeParse({ prefix: 'M-', digits: 9 }).success).toBe(false);
    expect(byKey.get('members.resignationNotice')!.schema.safeParse({ months: 1, at: 'quarterEnd' }).success).toBe(true);
  });

  it('registers next to the modules it depends on', () => {
    const registry = createRegistry([coreModule, contactsModule, dmsModule, projectsModule, financeModule, membersModule]);
    expect(registry.permissionKeys.has('members.fees')).toBe(true);
    expect(registry.settingDefinitions.has('members.numberFormat')).toBe(true);
  });

  it('brings the contact role member without its own retention', () => {
    expect(membersModule.contactRoles).toContainEqual(expect.objectContaining({ key: 'member', retention: 'none', managedBy: 'members' }));
  });

  // I-A: Ausgeschaltet schwiege das Modul als Halter und bei `recordDeleted` — Mitgliedschaften verwaisten am Kontakt.
  it('can be switched off without memberships, but not while an ended one is still kept', async () => {
    const { deps, ctx } = setupMembers();
    const admin = asMcp(ctxWith(['modules.manage']));
    expect(membersModule.canDisable!(deps)).toBeNull();

    const typeId = deps.db.select().from(memberTypes).all().find((t) => t.key === 'regular')!.id;
    const applied = await recordApplication(deps, ctx, { contactId: await person(deps), typeId, appliedOn: '2026-03-01' });
    if (!applied.ok) throw new Error(JSON.stringify(applied.error));
    await admitMember(deps, ctx, { membershipId: applied.value.id, admittedOn: '2026-03-15' });
    await endMembership(deps, ctx, { membershipId: applied.value.id, endsOn: '2026-08-31', reason: 'other' });

    const refused = await setModuleEnabled(deps, admin, { key: 'members', enabled: false });
    expect(refused.ok ? null : refused.error).toMatchObject({ code: 'moduleRefusesDisable', message: 'hasMemberships' });
  });

  it('is switched off through the module service when there is no membership', async () => {
    const { deps } = setupMembers();
    const res = await setModuleEnabled(deps, asMcp(ctxWith(['modules.manage'])), { key: 'members', enabled: false });
    expect(res.ok).toBe(true);
  });
});

import { coreModule, createRegistry } from '@kompass/core';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { financeModule } from '@kompass/module-finance';
import { projectsModule } from '@kompass/module-projects';
import { describe, expect, it } from 'vitest';
import { membersModule } from '../src/manifest';
import { MEMBERS_SETTINGS } from '../src/settings';

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
});

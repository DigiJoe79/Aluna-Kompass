import { coreModule, createRegistry, defineModule } from '@kompass/core';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { financeModule } from '@kompass/module-finance';
import { projectsModule } from '@kompass/module-projects';
import { describe, expect, it } from 'vitest';
import { membersModule } from '../src/manifest';
import { MEMBERS_SETTINGS } from '../src/settings';

describe('members manifest', () => {
  it('is a valid module with fixed permissions and its dependencies', () => {
    expect(() => defineModule(membersModule)).not.toThrow();
    expect(membersModule.key).toBe('members');
    expect(membersModule.version).toBe('0.1.0');
    expect([...membersModule.permissions]).toEqual(['members.read', 'members.manage', 'members.fees']);
    expect([...(membersModule.dependsOn ?? [])]).toEqual(['contacts', 'finance', 'dms']);
  });

  it('brings its settings with their defaults', () => {
    const byKey = new Map(MEMBERS_SETTINGS.map((s) => [s.key, s]));
    expect(membersModule.settings).toBe(MEMBERS_SETTINGS);
    expect(byKey.get('members.mcpHumanOnlyAllowed')).toMatchObject({ default: false, uiOnly: true });
    expect(byKey.get('members.numberFormat')?.default).toEqual({ prefix: '', digits: 4 });
    expect(byKey.get('members.resignationNotice')?.default).toEqual({ months: 3, at: 'fiscalYearEnd' });
    expect(byKey.get('members.joinYearRule')?.default).toBe('full');
    for (const s of MEMBERS_SETTINGS) expect(s.schema.safeParse(s.default).success, s.key).toBe(true);
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

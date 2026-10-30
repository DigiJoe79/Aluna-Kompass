import { coreModule, createRegistry, defineModule } from '@kompass/core';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { financeModule } from '@kompass/module-finance';
import { membersModule } from '@kompass/module-members';
import { projectsModule } from '@kompass/module-projects';
import { describe, expect, it } from 'vitest';
import { installedModules } from '../../../../apps/kompass/src/modules';
import { governanceModule } from '../src/manifest';
import { GOVERNANCE_SETTINGS } from '../src/settings';

describe('governance manifest', () => {
  it('is a valid module with its three permissions and its dependencies', () => {
    expect(() => defineModule(governanceModule)).not.toThrow();
    expect(governanceModule.key).toBe('governance');
    expect([...governanceModule.permissions]).toEqual(['governance.read', 'governance.manage', 'governance.record']);
    expect([...(governanceModule.dependsOn ?? [])].sort()).toEqual(['contacts', 'dms', 'finance', 'members']);
  });

  it('brings its settings with defaults', () => {
    const byKey = new Map(GOVERNANCE_SETTINGS.map((s) => [s.key, s]));
    expect(byKey.get('governance.mcpHumanOnlyAllowed')).toMatchObject({ default: false, uiOnly: true });
    const overdue = byKey.get('governance.registerOverdueDays')!;
    expect(overdue.default).toBe(28);
    expect(overdue.schema.safeParse(0).success).toBe(false);
    expect(overdue.schema.safeParse(366).success).toBe(false);
    const notice = byKey.get('governance.taxNoticeRequestDays')!;
    expect(notice.default).toBe(28);
    expect(notice.schema.safeParse(0).success).toBe(false);
    expect(notice.schema.safeParse(366).success).toBe(false);
  });

  it('defines the contact role auditor and the document area governance', () => {
    expect(governanceModule.contactRoles).toContainEqual({ key: 'auditor', retention: 'none', managedBy: 'governance' });
    expect(governanceModule.documentAreas).toContainEqual({ key: 'governance', permission: 'governance.read' });
  });

  it('registers next to the modules it depends on and is installed in the app', () => {
    const registry = createRegistry([coreModule, contactsModule, dmsModule, projectsModule, financeModule, membersModule, governanceModule]);
    expect(registry.permissionKeys.has('governance.manage')).toBe(true);
    expect(registry.settingDefinitions.has('governance.registerOverdueDays')).toBe(true);
    expect(installedModules.map((m) => m.key)).toContain('governance');
  });
});

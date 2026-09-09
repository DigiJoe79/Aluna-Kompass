import { describe, expect, it } from 'vitest';
import { buildCommandIndex } from '@/lib/command-index';
import type { NavGroup } from '@/lib/navigation';

const groups: NavGroup[] = [
  { key: 'admin', labelKey: 'nav.groups.admin', disabled: false, items: [
    { key: 'users', href: '/admin/users', icon: 'users', labelKey: 'nav.users', permission: 'users.manage', disabled: false, visible: true },
    { key: 'roles', href: '/admin/roles', icon: 'shield', labelKey: 'nav.roles', permission: 'roles.manage', disabled: false, visible: false },
  ] },
  { key: 'animals', labelKey: 'nav.groups.animals', disabled: false, items: [
    { key: 'animals.list', href: '/animals', icon: 'paw-print', labelKey: 'nav.animals.list', permission: 'animals.view', disabled: false, visible: true },
  ] },
];
const t = (k: string) => k;

describe('buildCommandIndex', () => {
  it('lists visible navigation targets and hides entries without permission', () => {
    const index = buildCommandIndex({ groups, settingsFields: [], permissions: new Set(['users.manage', 'animals.view']), t });
    expect(index.map((e) => e.id)).toEqual(['nav:users', 'nav:animals.list']);
  });
  it('adds settings fields as entries pointing at the settings page', () => {
    const index = buildCommandIndex({ groups: [], settingsFields: [{ key: 'organization.taxNumber', tab: 'tax' }], permissions: new Set(['settings.manage']), t });
    expect(index[0]).toMatchObject({ id: 'setting:organization.taxNumber', href: '/admin/settings?tab=tax', group: 'settings' });
  });
});

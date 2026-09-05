import { describe, expect, it } from 'vitest';
import { buildCommandIndex } from '@/lib/command-index';
import type { NavGroup } from '@/lib/navigation';

const groups: NavGroup[] = [
  { key: 'admin', labelKey: 'nav.groups.admin', disabled: false, items: [
    { key: 'users', href: '/admin/users', icon: 'users', labelKey: 'nav.users', permission: 'users.manage', disabled: false, visible: true },
    { key: 'roles', href: '/admin/roles', icon: 'shield', labelKey: 'nav.roles', permission: 'roles.manage', disabled: false, visible: false },
  ] },
  { key: 'finance', labelKey: 'nav.groups.finance', disabled: true, items: [
    { key: 'finance.ledger', href: '/finance', icon: 'euro', labelKey: 'nav.finance.ledger', permission: 'finance.view', disabled: true, visible: true },
  ] },
];
const t = (k: string) => k;

describe('buildCommandIndex', () => {
  it('lists visible navigation targets, hides entries without permission and greys out inactive modules with a reason', () => {
    const index = buildCommandIndex({ groups, settingsFields: [], permissions: new Set(['users.manage', 'finance.view']), t });
    expect(index.map((e) => [e.id, e.disabled])).toEqual([['nav:users', false], ['nav:finance.ledger', true]]);
    expect(index[1]?.disabledReason).toBe('palette.moduleInactive');
  });
  it('adds settings fields as entries pointing at the settings page', () => {
    const index = buildCommandIndex({ groups: [], settingsFields: [{ key: 'organization.taxNumber', tab: 'tax' }], permissions: new Set(['settings.manage']), t });
    expect(index[0]).toMatchObject({ id: 'setting:organization.taxNumber', href: '/admin/settings?tab=tax', group: 'settings' });
  });
});

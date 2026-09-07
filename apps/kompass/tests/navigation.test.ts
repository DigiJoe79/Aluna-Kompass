import { coreModule, defineModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { buildNavigation } from '@/lib/navigation';

const finance = defineModule({
  key: 'finance',
  version: '0.1.0',
  permissions: ['finance.view'],
  navigation: [{ key: 'finance.ledger', href: '/finance', icon: 'euro', group: 'finance', permission: 'finance.view' }],
});

describe('buildNavigation', () => {
  it('builds the admin group with all nine core entries, filtered by permission', () => {
    const groups = buildNavigation({ manifests: [coreModule], enabledKeys: new Set(['core']), permissions: new Set(['users.manage', 'audit.view']) });
    const admin = groups.find((g) => g.key === 'admin')!;
    expect(admin.items.map((i) => i.key)).toEqual(['users', 'roles', 'settings', 'locales', 'themes', 'modules', 'audit', 'documents', 'backup']);
    expect(admin.items.filter((i) => i.visible).map((i) => i.key)).toEqual(['users', 'audit']);
  });

  it('renders installed but inactive modules as disabled groups', () => {
    const groups = buildNavigation({ manifests: [coreModule, finance], enabledKeys: new Set(['core']), permissions: new Set(['finance.view']) });
    const group = groups.find((g) => g.key === 'finance')!;
    expect(group.disabled).toBe(true);
    expect(group.items[0]).toMatchObject({ key: 'finance.ledger', href: '/finance', disabled: true });
  });

  it('enables module groups once the module is active', () => {
    const groups = buildNavigation({ manifests: [coreModule, finance], enabledKeys: new Set(['core', 'finance']), permissions: new Set(['finance.view']) });
    expect(groups.find((g) => g.key === 'finance')?.disabled).toBe(false);
  });
});

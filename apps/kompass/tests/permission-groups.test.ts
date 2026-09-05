import { coreModule, defineModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { groupPermissions } from '@/lib/permission-groups';

describe('groupPermissions', () => {
  it('splits core permissions into three labelled groups in design order', () => {
    const groups = groupPermissions([coreModule]);
    expect(groups.map((g) => [g.key, g.keys])).toEqual([
      ['core.admin', ['users.manage', 'roles.manage', 'settings.manage', 'modules.manage']],
      ['core.accountability', ['audit.view', 'documents.view']],
      ['core.data', ['documents.create', 'media.upload', 'backup.export', 'backup.import']],
    ]);
  });
  it('adds one group per module', () => {
    const finance = defineModule({ key: 'finance', version: '1', permissions: ['finance.view', 'finance.edit'] });
    expect(groupPermissions([coreModule, finance]).at(-1)).toEqual({ key: 'finance', labelKey: 'permissions.groups.finance', keys: ['finance.view', 'finance.edit'] });
  });
});

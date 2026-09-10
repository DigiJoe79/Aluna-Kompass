import { CORE_PERMISSIONS, coreModule, defineModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { groupPermissions } from '@/lib/permission-groups';

describe('groupPermissions', () => {
  it('splits core permissions into labelled groups in design order', () => {
    const groups = groupPermissions([coreModule]);
    expect(groups.map((g) => [g.key, g.keys])).toEqual([
      ['core.admin', ['users.manage', 'roles.manage', 'settings.manage', 'modules.manage']],
      ['core.accountability', ['audit.view', 'retention.view']],
      ['core.data', ['documents.export', 'media.upload', 'backup.export', 'backup.import']],
      ['core.projects', ['projects.view', 'projects.manage']],
    ]);
  });
  /**
   * Die Kerngruppen stehen als Liste da, die Kernrechte in einer zweiten.
   * Wer ein Recht ergänzt und die Gruppe vergisst, baut ein Recht, das im
   * Rolleneditor nie erscheint und das deshalb niemand vergeben kann.
   */
  it('puts every core permission into a group', () => {
    const grouped = new Set(groupPermissions([coreModule]).flatMap((g) => g.keys));
    expect([...CORE_PERMISSIONS].filter((key) => !grouped.has(key))).toEqual([]);
  });

  it('adds one group per module', () => {
    const finance = defineModule({ key: 'finance', version: '1', permissions: ['finance.view', 'finance.edit'] });
    expect(groupPermissions([coreModule, finance]).at(-1)).toEqual({ key: 'finance', labelKey: 'permissions.groups.finance', keys: ['finance.view', 'finance.edit'] });
  });
});

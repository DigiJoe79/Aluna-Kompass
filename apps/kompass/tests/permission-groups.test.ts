import { readFileSync } from 'node:fs';
import { CORE_PERMISSIONS, coreModule, defineModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { groupPermissions } from '@/lib/permission-groups';
import { installedModules } from '@/modules';

describe('groupPermissions', () => {
  it('labels every group and puts each permission into exactly one, naming only real permissions', () => {
    const groups = groupPermissions([coreModule, ...installedModules]);
    const keys = groups.flatMap((g) => g.keys);
    expect(new Set(keys).size).toBe(keys.length);
    const known = new Set([...coreModule.permissions, ...installedModules.flatMap((m) => m.permissions)]);
    expect(keys.filter((key) => !known.has(key))).toEqual([]);
    const messages = JSON.parse(readFileSync(new URL('../messages/de.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    const label = (key: string) => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
    expect(groups.filter((g) => typeof label(g.labelKey) !== 'string').map((g) => g.key)).toEqual([]);
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

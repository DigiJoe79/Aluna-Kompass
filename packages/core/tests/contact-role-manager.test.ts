import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { writeSettingInternal } from '../src/settings/service';
import { contactRoleManager, contactRoleRowManager } from '../src/modules/contact-role-manager';
import { defineModule, type ContactRoleDefinition } from '../src/modules/manifest';
import { createRegistry } from '../src/modules/registry';
import { createTestDeps, ctxWith } from '../src/testing';

const owner = defineModule({
  key: 'fin',
  version: '1',
  permissions: ['fin.view'],
  contactRoles: [
    { key: 'board-member', retention: 'none' },
    { key: 'member', retention: 'none', managedBy: 'members' },
  ],
});
const gov = defineModule({ key: 'gov', version: '1', permissions: ['gov.view'], managesContactRoles: ['board-member'], ownsContactRoleRow: (_deps, rowId) => rowId === 'owned' });

function setup(enabled: string[]) {
  const deps = createTestDeps({ manifests: [coreModule, owner, gov] });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', enabled));
  return deps;
}
const role = (key: string): ContactRoleDefinition => owner.contactRoles!.find((r) => r.key === key)!;

describe('contactRoleManager', () => {
  it('names the static manager of a role', () => {
    expect(contactRoleManager(setup(['fin']), role('member'))).toBe('members');
  });

  it('names the enabled module that manages a foreign role, and nobody once it is disabled', () => {
    expect(contactRoleManager(setup(['fin', 'gov']), role('board-member'))).toBe('gov');
    expect(contactRoleManager(setup(['fin']), role('board-member'))).toBeNull();
  });

  it('V-1: a row the managing module does not own stays in hand; managedBy and modules without the hook own every row', () => {
    const on = setup(['fin', 'gov']);
    expect(contactRoleRowManager(on, role('board-member'), 'owned')).toBe('gov');
    expect(contactRoleRowManager(on, role('board-member'), 'legacy')).toBeNull();
    expect(contactRoleRowManager(setup(['fin']), role('board-member'), 'owned')).toBeNull();
    expect(contactRoleRowManager(on, role('member'), 'legacy')).toBe('members');
  });

  it('the registry refuses a role managed twice', () => {
    const other = defineModule({ key: 'other', version: '1', permissions: ['other.view'], managesContactRoles: ['board-member'] });
    expect(() => createRegistry([coreModule, owner, gov, other])).toThrow(/roleManagedTwice/);
    const again = defineModule({ key: 'again', version: '1', permissions: ['again.view'], managesContactRoles: ['member'] });
    expect(() => createRegistry([coreModule, owner, again])).toThrow(/roleManagedTwice/);
  });

  it('defineModule checks the form of managesContactRoles', () => {
    expect(() => defineModule({ key: 'x', version: '1', permissions: [], managesContactRoles: [] })).toThrow();
    expect(() => defineModule({ key: 'x', version: '1', permissions: [], managesContactRoles: ['a', 'a'] })).toThrow();
  });
});

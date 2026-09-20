import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';

describe('contacts manifest', () => {
  it('declares its key, permissions and navigation without depending on other modules', () => {
    expect(contactsModule.key).toBe('contacts');
    expect([...contactsModule.permissions]).toEqual(['contacts.view', 'contacts.manage']);
    expect([...(contactsModule.dependsOn ?? [])]).toEqual([]);
    expect(contactsModule.navigation?.[0]).toMatchObject({ href: '/contacts', permission: 'contacts.view' });
  });

  it('declares the user link as not deletable — it is ended, never removed', () => {
    expect(contactsModule.deletionRules).toContainEqual(expect.objectContaining({ entity: 'contactUserLink', deletable: false }));
  });
});

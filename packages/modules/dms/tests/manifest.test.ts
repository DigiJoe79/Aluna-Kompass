import { describe, expect, it } from 'vitest';
import { dmsModule } from '../src/manifest';
import { fileFixture, setupWithProbe, setupWithTypes } from './helpers';

describe('dms module', () => {
  it('hat den Schlüssel dms und hängt an den Kontakten', () => {
    expect(dmsModule.key).toBe('dms');
    expect(dmsModule.dependsOn).toContain('contacts');
  });

  it('führt die sechs Rechte der Akte', () => {
    expect(dmsModule.permissions).toEqual([
      'dms.view', 'dms.create', 'dms.file', 'dms.void', 'dms.deleteDraft', 'dms.manage',
    ]);
  });

  it('refuses to be switched off once a document is filed — its links hold contacts', async () => {
    const { deps, ctx } = setupWithTypes();
    expect(dmsModule.canDisable!(deps)).toBeNull();
    await fileFixture(deps, ctx);
    expect(dmsModule.canDisable!(deps)).toBe('hasFinalRecords');
  });

  it('the navigation entry opens for dms.view and for every registered area permission', () => {
    const { deps } = setupWithProbe();
    expect(dmsModule.navigation ?? []).toEqual([]);
    expect(dmsModule.navigationFor!(deps)).toEqual([{ key: 'dms.list', href: '/dms', icon: 'file', group: 'dms', permission: ['dms.view', 'probe.read'] }]);
  });
});

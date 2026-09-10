import { describe, expect, it } from 'vitest';
import { dmsModule } from '../src/manifest';

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
});

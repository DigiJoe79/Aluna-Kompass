import { describe, expect, it } from 'vitest';
import { diffFields } from '@/lib/audit-diff';

describe('diffFields', () => {
  it('lists only changed keys of two objects', () => {
    expect(diffFields({ name: 'Alt', email: 'a@x', isActive: true }, { name: 'Neu', email: 'a@x', isActive: true })).toEqual([
      { key: 'name', before: 'Alt', after: 'Neu' },
    ]);
  });
  it('handles added and removed keys and nested values as JSON', () => {
    expect(diffFields({ roles: [{ id: '1' }] }, { roles: [{ id: '1' }, { id: '2' }], note: 'x' })).toEqual([
      { key: 'roles', before: '[{"id":"1"}]', after: '[{"id":"1"},{"id":"2"}]' },
      { key: 'note', before: null, after: 'x' },
    ]);
  });
  it('treats primitives as a single value row and null sides as create/delete', () => {
    expect(diffFields('Alt', 'Neu')).toEqual([{ key: 'value', before: 'Alt', after: 'Neu' }]);
    expect(diffFields(null, { name: 'Neu' })).toEqual([{ key: 'name', before: null, after: 'Neu' }]);
    expect(diffFields(undefined, undefined)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { rolesForFunction } from '../src/term-roles';

describe('rolesForFunction', () => {
  it('maps an office function to the contact roles that follow from it', () => {
    expect(rolesForFunction('chair')).toEqual(['board-member']);
    expect(rolesForFunction('board')).toEqual(['board-member']);
    expect(rolesForFunction('treasurer')).toEqual(['board-member', 'treasurer']);
    expect(rolesForFunction('auditor')).toEqual(['auditor']);
    expect(rolesForFunction(null)).toEqual([]);
  });
});

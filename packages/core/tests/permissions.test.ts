import { describe, expect, it } from 'vitest';
import { systemContext } from '../src/context';
import { CORE_PERMISSIONS } from '../src/permissions/core';
import { hasPermission, requireAnyPermission, requirePermission } from '../src/permissions/check';
import { ctxWith } from '../src/testing';

describe('permissions', () => {
  it('defines the core permission keys', () => {
    expect([...CORE_PERMISSIONS].sort()).toEqual([
      'audit.view',
      'backup.export',
      'backup.import',
      'documents.export',
      'followUps.manage',
      'followUps.view',
      'media.upload',
      'modules.manage',
      'retention.view',
      'roles.manage',
      'settings.manage',
      'users.manage',
    ]);
  });

  it('requirePermission returns null when granted and forbidden otherwise', () => {
    const ctx = ctxWith(['users.manage']);
    expect(hasPermission(ctx, 'users.manage')).toBe(true);
    expect(requirePermission(ctx, 'users.manage')).toBeNull();
    expect(requirePermission(ctx, 'roles.manage')).toEqual({
      ok: false,
      error: { type: 'forbidden', permission: 'roles.manage' },
    });
  });

  it('requireAnyPermission accepts one of several keys', () => {
    const ctx = ctxWith(['users.manage']);
    expect(requireAnyPermission(ctx, ['roles.manage', 'users.manage'])).toBeNull();
    expect(requireAnyPermission(ctx, ['roles.manage', 'audit.view'])?.error).toEqual({
      type: 'forbidden',
      permission: 'roles.manage',
    });
  });

  it('systemContext has no user and no permissions', () => {
    const ctx = systemContext('req-1');
    expect(ctx.userId).toBeNull();
    expect(ctx.channel).toBe('system');
    expect(ctx.permissions.size).toBe(0);
    expect(ctx.requestId).toBe('req-1');
  });
});

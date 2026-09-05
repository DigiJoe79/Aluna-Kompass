import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { recordAudit } from '../src/audit/log';
import { auditLog } from '../src/db/schema';
import { createTestDeps, ctxWith, systemContext } from '../src/testing';

describe('recordAudit', () => {
  it('writes user, channel, request metadata, environment and JSON payloads', () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['settings.manage']);
    const id = recordAudit(deps.db, deps, ctx, {
      action: 'settings.update',
      entityType: 'setting',
      entityId: 'organization.name',
      before: 'Alt',
      after: 'Neu',
      summary: 'organization.name geändert',
    });
    const row = deps.db.select().from(auditLog).where(eq(auditLog.id, id)).get();
    expect(row).toMatchObject({
      occurredAt: '2026-09-05T08:00:00.000Z',
      userId: 'USER-TEST',
      channel: 'ui',
      action: 'settings.update',
      entityType: 'setting',
      entityId: 'organization.name',
      before: '"Alt"',
      after: '"Neu"',
      ipAddress: '127.0.0.1',
      requestId: 'REQ-TEST',
      environment: 'test',
      apiTokenId: null,
    });
  });

  it('stores system entries without a user and omits absent payloads', () => {
    const deps = createTestDeps();
    const id = recordAudit(deps.db, deps, systemContext('REQ-SYS'), {
      action: 'auth.locked',
      entityType: 'user',
      entityId: 'U1',
      summary: 'Konto gesperrt',
    });
    const row = deps.db.select().from(auditLog).where(eq(auditLog.id, id)).get();
    expect(row?.userId).toBeNull();
    expect(row?.channel).toBe('system');
    expect(row?.before).toBeNull();
    expect(row?.after).toBeNull();
  });

  it('rejects UPDATE and DELETE on audit_log at the database level', () => {
    const deps = createTestDeps();
    recordAudit(deps.db, deps, ctxWith([]), {
      action: 'x',
      entityType: 'y',
      entityId: null,
      summary: 's',
    });
    expect(() => deps.sqlite.prepare("update audit_log set summary = 'hacked'").run()).toThrow(/immutable/);
    expect(() => deps.sqlite.prepare('delete from audit_log').run()).toThrow(/immutable/);
  });
});

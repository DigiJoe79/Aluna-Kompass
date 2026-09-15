import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { recordAudit } from '../src/audit/log';
import { auditLog } from '../src/db/schema';
import { auditEntry, createTestDeps, ctxWith, systemContext } from '../src/testing';

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

/**
 * Der Helfer, mit dem die Dienst-Tests ihren Protokolleintrag abholen. Er wirft
 * statt `undefined` zu liefern: Eine Zusicherung gegen `undefined` sagt nur
 * „ist nicht das, was ich erwarte“ — die Meldung soll aber sagen, dass der
 * Eintrag ganz fehlt, und was stattdessen geschrieben wurde.
 */
describe('auditEntry', () => {
  const record = (deps: ReturnType<typeof createTestDeps>, action: string, summary: string) =>
    recordAudit(deps.db, deps, ctxWith([]), { action, entityType: 'thing', entityId: 'T1', summary });

  it('returns the most recent entry for one action', () => {
    const deps = createTestDeps();
    record(deps, 'users.update', 'erst');
    record(deps, 'users.create', 'dazwischen');
    record(deps, 'users.update', 'zuletzt');
    expect(auditEntry(deps, 'users.update')).toMatchObject({ action: 'users.update', summary: 'zuletzt' });
  });

  it('names the recorded actions when the wanted one is missing', () => {
    const deps = createTestDeps();
    record(deps, 'users.create', 'da');
    expect(() => auditEntry(deps, 'users.assignRole')).toThrow(/users\.assignRole.*users\.create/s);
  });
});

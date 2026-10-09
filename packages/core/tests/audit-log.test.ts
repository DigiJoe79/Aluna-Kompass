import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { recordAudit } from '../src/audit/log';
import { coreModule } from '../src/core-module';
import { auditLog } from '../src/db/schema';
import { defineModule } from '../src/modules/manifest';
import { createRegistry } from '../src/modules/registry';
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
      params: { key: 'organization.name' },
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
      params: { targetUserId: 'U1', attempts: 5 },
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
      action: 'auth.login',
      entityType: 'y',
      entityId: null,
    });
    expect(() => deps.sqlite.prepare("update audit_log set action = 'hacked'").run()).toThrow(/immutable/);
    expect(() => deps.sqlite.prepare('delete from audit_log').run()).toThrow(/immutable/);
  });
});

describe('recordAudit params and catalog (Spec Protokoll § 2–3)', () => {
  const probe = defineModule({
    key: 'probe',
    version: '0',
    permissions: [],
    auditActions: {
      'probe.rename': { params: ['name', 'targetUserId'] },
      'probe.touch': { params: [] },
    },
  });
  const deps = createTestDeps({ manifests: [coreModule, probe] });
  const ctx = ctxWith([]);

  it('stores params as JSON and no summary', () => {
    recordAudit(deps.db, deps, ctx, { action: 'probe.rename', entityType: 'probe', entityId: 'P1', params: { name: 'Neu', targetUserId: 'U1' } });
    const entry = auditEntry(deps, 'probe.rename');
    expect(entry).toMatchObject({ params: '{"name":"Neu","targetUserId":"U1"}' });
    expect(entry).not.toHaveProperty('summary');
  });

  it('stores no params for an action without values', () => {
    recordAudit(deps.db, deps, ctx, { action: 'probe.touch', entityType: 'probe', entityId: 'P1' });
    expect(auditEntry(deps, 'probe.touch')).toMatchObject({ params: null });
  });

  it('rejects a key the catalog does not name, and a missing one', () => {
    expect(() => recordAudit(deps.db, deps, ctx, { action: 'probe.rename', entityType: 'probe', entityId: 'P1', params: { name: 'x', targetUserId: 'U1', extra: 1 } })).toThrow(/probe\.rename.*extra/);
    expect(() => recordAudit(deps.db, deps, ctx, { action: 'probe.rename', entityType: 'probe', entityId: 'P1', params: { name: 'x' } })).toThrow(/probe\.rename.*targetUserId/);
  });

  it('rejects non-scalar values and personal fields', () => {
    expect(() => recordAudit(deps.db, deps, ctx, { action: 'probe.touch', entityType: 'probe', entityId: null, params: { a: { b: 1 } as never } })).toThrow(/not a scalar/);
    expect(() => defineModule({ key: 'mail', version: '0', permissions: [], auditActions: { 'mail.x': { params: ['email'] } } })).toThrow(/invalid audit param: mail\.x\.email/);
    expect(() => defineModule({ key: 'mail', version: '0', permissions: [], auditActions: { 'mail.x': { params: ['contactIban'] } } })).toThrow(/invalid audit param/);
    expect(() => defineModule({ key: 'mail', version: '0', permissions: [], auditActions: { Mail: { params: [] } } })).toThrow(/invalid audit action: Mail/);
  });

  it('rejects an action that no catalog names', () => {
    expect(() => recordAudit(deps.db, deps, ctx, { action: 'legacy.thing', entityType: 'x', entityId: null })).toThrow(/legacy\.thing: not in any auditActions catalog/);
  });

  it('rejects two modules declaring the same action', () => {
    const twin = defineModule({ key: 'twin', version: '0', permissions: [], auditActions: { 'probe.touch': { params: [] } } });
    expect(() => createRegistry([coreModule, probe, twin])).toThrow(/duplicate audit action: probe\.touch/);
  });
});

/**
 * Der Helfer, mit dem die Dienst-Tests ihren Protokolleintrag abholen. Er wirft
 * statt `undefined` zu liefern: Eine Zusicherung gegen `undefined` sagt nur
 * „ist nicht das, was ich erwarte“ — die Meldung soll aber sagen, dass der
 * Eintrag ganz fehlt, und was stattdessen geschrieben wurde.
 */
describe('auditEntry', () => {
  const record = (deps: ReturnType<typeof createTestDeps>, action: string, entityId: string) =>
    recordAudit(deps.db, deps, ctxWith([]), { action, entityType: 'thing', entityId });

  it('returns the most recent entry for one action', () => {
    const deps = createTestDeps();
    record(deps, 'locale.reorder', 'erst');
    record(deps, 'auth.login', 'dazwischen');
    record(deps, 'locale.reorder', 'zuletzt');
    expect(auditEntry(deps, 'locale.reorder')).toMatchObject({ action: 'locale.reorder', entityId: 'zuletzt' });
  });

  it('names the recorded actions when the wanted one is missing', () => {
    const deps = createTestDeps();
    record(deps, 'auth.login', 'da');
    expect(() => auditEntry(deps, 'users.assignRole')).toThrow(/users\.assignRole.*auth\.login/s);
  });
});

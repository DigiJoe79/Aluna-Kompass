import { describe, expect, it } from 'vitest';
import { recordAudit } from '../src/audit/log';
import { getAuditEntry, queryAudit } from '../src/audit/query';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser, systemContext } from '../src/testing';

describe('audit query', () => {
  function seed(deps: ReturnType<typeof createTestDeps>) {
    const anna = insertUser(deps, { name: 'Anna Berger', email: 'anna@example.org' });
    recordAudit(deps.db, deps, ctxWith([], anna), { action: 'settings.update', entityType: 'setting', entityId: 'organization.name', before: 'A', after: 'B', summary: 'organization.name geändert' });
    deps.clock.advance(1000);
    recordAudit(deps.db, deps, { ...ctxWith([], anna), channel: 'mcp', apiTokenId: 'T1' }, { action: 'roles.create', entityType: 'role', entityId: 'R1', summary: 'Rolle angelegt' });
    deps.clock.advance(1000);
    recordAudit(deps.db, deps, systemContext('REQ-S'), { action: 'auth.locked', entityType: 'user', entityId: anna, summary: 'Konto gesperrt' });
    return anna;
  }

  it('returns newest first with user names and parsed payloads', () => {
    const deps = createTestDeps();
    seed(deps);
    const { entries, total } = unwrap(queryAudit(deps, ctxWith(['audit.view']), {}));
    expect(total).toBe(3);
    expect(entries.map((e) => e.action)).toEqual(['auth.locked', 'roles.create', 'settings.update']);
    expect(entries[2]).toMatchObject({ userName: 'Anna Berger', before: 'A', after: 'B' });
    expect(entries[0]?.userName).toBeNull();
  });

  it('filters by channel, user, action, entity, time range and text', () => {
    const deps = createTestDeps();
    const anna = seed(deps);
    const view = ctxWith(['audit.view']);
    expect(unwrap(queryAudit(deps, view, { channel: 'mcp' })).entries.map((e) => e.action)).toEqual(['roles.create']);
    expect(unwrap(queryAudit(deps, view, { userId: anna })).total).toBe(2);
    expect(unwrap(queryAudit(deps, view, { action: 'auth.locked' })).total).toBe(1);
    expect(unwrap(queryAudit(deps, view, { entityType: 'setting', entityId: 'organization.name' })).total).toBe(1);
    expect(unwrap(queryAudit(deps, view, { from: '2026-09-05T08:00:01.000Z' })).total).toBe(2);
    expect(unwrap(queryAudit(deps, view, { to: '2026-09-05T08:00:01.000Z' })).total).toBe(2);
    expect(unwrap(queryAudit(deps, view, { text: 'gesperrt' })).total).toBe(1);
    expect(unwrap(queryAudit(deps, view, { limit: 1, offset: 1 })).entries.map((e) => e.action)).toEqual(['roles.create']);
  });

  it('requires audit.view and validates limits', () => {
    const deps = createTestDeps();
    seed(deps);
    expect(queryAudit(deps, ctxWith(['users.manage']), {}).ok).toBe(false);
    const tooMany = queryAudit(deps, ctxWith(['audit.view']), { limit: 5000 });
    expect(tooMany.ok === false && tooMany.error.type === 'validation').toBe(true);
    const id = unwrap(queryAudit(deps, ctxWith(['audit.view']), {})).entries[0]!.id;
    expect(unwrap(getAuditEntry(deps, ctxWith(['audit.view']), id)).action).toBe('auth.locked');
    expect(getAuditEntry(deps, ctxWith(['audit.view']), 'nope').ok).toBe(false);
  });
});

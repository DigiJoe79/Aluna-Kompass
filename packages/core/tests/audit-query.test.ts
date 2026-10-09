import { describe, expect, it } from 'vitest';
import { recordAudit } from '../src/audit/log';
import { getAuditEntry, listAuditActions, queryAudit } from '../src/audit/query';
import { unwrap } from '../src/result';
import { createApiToken } from '../src/auth/tokens';
import { coreModule } from '../src/core-module';
import { defineModule } from '../src/modules/manifest';
import { createTestDeps, ctxWith, insertUser, systemContext } from '../src/testing';

describe('audit query', () => {
  function seed(deps: ReturnType<typeof createTestDeps>) {
    const anna = insertUser(deps, { name: 'Anna Berger', email: 'anna@example.org' });
    recordAudit(deps.db, deps, ctxWith([], anna), { action: 'settings.update', entityType: 'setting', entityId: 'organization.name', before: 'A', after: 'B', params: { key: 'organization.name' } });
    deps.clock.advance(1000);
    recordAudit(deps.db, deps, { ...ctxWith([], anna), channel: 'mcp', apiTokenId: 'T1' }, { action: 'roles.create', entityType: 'role', entityId: 'R1', params: { roleName: 'Vorstand' } });
    deps.clock.advance(1000);
    recordAudit(deps.db, deps, systemContext('REQ-S'), { action: 'auth.locked', entityType: 'user', entityId: anna, params: { targetUserId: anna, attempts: 5 } });
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
    expect(unwrap(queryAudit(deps, view, { text: 'organization' })).total).toBe(1);
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

  // Die Token-Seite verspricht „mit dem Kanal „MCP“ und dem Namen des Tokens“ — die Detailansicht zeigte nur die Kennung.
  it('names the API token of an MCP entry', async () => {
    const deps = createTestDeps();
    const anna = insertUser(deps, { name: 'Anna Berger', email: 'anna@example.org' });
    const { record } = unwrap(await createApiToken(deps, ctxWith([], anna), { name: 'Hundeblicke-Sync' }));
    recordAudit(deps.db, deps, { ...ctxWith([], anna), channel: 'mcp', apiTokenId: record.id }, { action: 'roles.create', entityType: 'role', entityId: 'R1', params: { roleName: 'Vorstand' } });
    recordAudit(deps.db, deps, { ...ctxWith([], anna), channel: 'mcp', apiTokenId: 'GONE' }, { action: 'roles.create', entityType: 'role', entityId: 'R2', params: { roleName: 'Vorstand' } });
    const view = ctxWith(['audit.view']);
    const byEntity = (id: string) => unwrap(queryAudit(deps, view, { entityId: id })).entries[0]!;
    expect(byEntity('R1').apiTokenName).toBe('Hundeblicke-Sync');
    expect(unwrap(getAuditEntry(deps, view, byEntity('R1').id)).apiTokenName).toBe('Hundeblicke-Sync');
    expect(byEntity('R2').apiTokenName).toBeNull();
  });

  /** Spec Filterleisten § 4: Der Filter „Aktion“ bietet alle vorkommenden Aktionen an, nicht nur die der letzten 200. */
  it('lists every action that occurs, sorted and once each, also beyond the newest 200 entries', () => {
    const deps = createTestDeps();
    const anna = seed(deps);
    for (let i = 0; i < 205; i++) {
      deps.clock.advance(1000);
      recordAudit(deps.db, deps, ctxWith([], anna), { action: 'locale.reorder', entityType: 'locale', entityId: `A${i}` });
    }
    expect(unwrap(queryAudit(deps, ctxWith(['audit.view']), { limit: 200 })).entries.every((e) => e.action === 'locale.reorder')).toBe(true);
    expect(unwrap(listAuditActions(deps, ctxWith(['audit.view'])))).toEqual(['auth.locked', 'locale.reorder', 'roles.create', 'settings.update']);
    expect(listAuditActions(deps, ctxWith([]))).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'audit.view' } });
  });

  describe('params (Spec Protokoll § 4)', () => {
    const probe = defineModule({ key: 'probe', version: '0', permissions: [], auditActions: { 'probe.rename': { params: ['name', 'targetUserId'] } } });
    const setup = () => {
      const deps = createTestDeps({ manifests: [coreModule, probe] });
      const admin = insertUser(deps, { name: 'Erika Muster', email: 'erika@example.org' });
      recordAudit(deps.db, deps, ctxWith([], admin), { action: 'probe.rename', entityType: 'probe', entityId: 'P1', params: { name: '2026-0012', targetUserId: admin } });
      recordAudit(deps.db, deps, ctxWith([], admin), { action: 'probe.rename', entityType: 'probe', entityId: 'P2', params: { name: '2026-0013', targetUserId: 'GONE' } });
      return { deps, admin, view: ctxWith(['audit.view']) };
    };

    it('searches what is stored: params, entity id, before/after — not the sentence', () => {
      const { deps, view } = setup();
      expect(queryAudit(deps, view, { text: '2026-0012' })).toMatchObject({ ok: true, value: { total: 1 } });
      expect(queryAudit(deps, view, { text: 'umbenannt' })).toMatchObject({ ok: true, value: { total: 0 } });
    });

    it('returns params parsed and the names of users named in params', () => {
      const { deps, admin, view } = setup();
      const entries = unwrap(queryAudit(deps, view, { action: 'probe.rename' })).entries;
      const p1 = entries.find((e) => e.entityId === 'P1')!;
      expect(p1).toMatchObject({ params: { name: '2026-0012', targetUserId: admin }, paramUserNames: { [admin]: 'Erika Muster' } });
      expect(entries.find((e) => e.entityId === 'P2')).toMatchObject({ paramUserNames: { GONE: null } });
      expect(unwrap(getAuditEntry(deps, view, p1.id))).toMatchObject({ paramUserNames: { [admin]: 'Erika Muster' } });
    });

    it('gives an old entry without params null and no names', () => {
      const { deps, view } = setup();
      recordAudit(deps.db, deps, ctxWith([]), { action: 'locale.reorder', entityType: 'locale', entityId: 'de' });
      expect(unwrap(queryAudit(deps, view, { action: 'locale.reorder' })).entries[0]).toMatchObject({ params: null, paramUserNames: {} });
    });
  });
});

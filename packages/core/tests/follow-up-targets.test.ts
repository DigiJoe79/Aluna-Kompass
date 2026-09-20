import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { settings } from '../src/db/schema';
import { createFollowUp, listFollowUps } from '../src/follow-ups/service';
import { listDueFollowUpsWithTargets, resolveFollowUpTarget } from '../src/follow-ups/targets';
import { defineModule } from '../src/modules/manifest';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith } from '../src/testing';

const files = defineModule({
  key: 'files',
  version: '0',
  permissions: [],
  followUpTargets: (_deps, entityType, id) => (entityType === 'document' ? { label: `Dokument ${id}`, href: `/dms/${id}` } : null),
});

function setup(enabled: string[]) {
  const deps = createTestDeps({ manifests: [coreModule, files] });
  deps.db.insert(settings).values({ key: 'modules.enabled', value: JSON.stringify(enabled), updatedAt: 'now' }).run();
  return deps;
}

describe('followUpTargets', () => {
  it('ein eingeschaltetes Modul beschriftet seine Entität', () => {
    const deps = setup(['files']);
    expect(resolveFollowUpTarget(deps, 'document', 'D1')).toEqual({ label: 'Dokument D1', href: '/dms/D1' });
  });

  it('ein ausgeschaltetes Modul schweigt, ein fremder Typ bleibt ohne Ziel', () => {
    expect(resolveFollowUpTarget(setup([]), 'document', 'D1')).toBeNull();
    expect(resolveFollowUpTarget(setup(['files']), 'invoice', 'I1')).toBeNull();
  });

  it('die Fälligkeitsliste trägt das Ziel an jeder Zeile', async () => {
    const deps = setup(['files']);
    const ctx = ctxWith(['followUps.view', 'followUps.manage']);
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-01', title: 'a' });
    await createFollowUp(deps, ctx, { entityType: 'invoice', entityId: 'I1', dueAt: '2026-09-02', title: 'b' });
    const due = await listDueFollowUpsWithTargets(deps, ctx, { until: '2026-09-30' });
    expect(due.ok && due.value.map((f) => f.target)).toEqual([{ label: 'Dokument D1', href: '/dms/D1' }, null]);
  });

  const things = defineModule({
    key: 'things',
    version: '0',
    permissions: ['things.view'],
    recordLabels: (_deps, ctx, type, id) =>
      type !== 'thing'
        ? null
        : ctx.permissions.has('things.view')
          ? { label: `Ding ${id}`, href: `/things/${id}`, state: 'ok' }
          : { label: 'Ding (kein Zugriff)', href: null, state: 'forbidden' },
  });

  it('hides the title of a follow-up at a record the caller may not read', async () => {
    const deps = createTestDeps({ manifests: [coreModule, things] });
    deps.db.insert(settings).values({ key: 'modules.enabled', value: JSON.stringify(['things']), updatedAt: 'now' }).run();
    const manage = ctxWith(['followUps.view', 'followUps.manage']);
    await createFollowUp(deps, manage, { entityType: 'thing', entityId: 'T1', dueAt: '2026-09-01', title: 'Geheimer Anlass' });
    const mayRead = await listDueFollowUpsWithTargets(deps, ctxWith(['followUps.view', 'things.view']), { until: '2099-01-01' });
    const mayNot = await listDueFollowUpsWithTargets(deps, ctxWith(['followUps.view']), { until: '2099-01-01' });
    expect(unwrap(mayRead)[0]).toMatchObject({ title: 'Geheimer Anlass', titleHidden: false, target: { label: 'Ding T1', href: '/things/T1' } });
    expect(unwrap(mayNot)[0]).toMatchObject({ title: '', titleHidden: true, target: { label: 'Ding (kein Zugriff)', href: null } });
  });

  it('listFollowUps hides it too', async () => {
    const deps = createTestDeps({ manifests: [coreModule, things] });
    deps.db.insert(settings).values({ key: 'modules.enabled', value: JSON.stringify(['things']), updatedAt: 'now' }).run();
    const manage = ctxWith(['followUps.view', 'followUps.manage']);
    await createFollowUp(deps, manage, { entityType: 'thing', entityId: 'T1', dueAt: '2026-09-01', title: 'Geheimer Anlass' });
    const rows = unwrap(await listFollowUps(deps, ctxWith(['followUps.view']), { entityType: 'thing', entityId: 'T1' }));
    expect(rows[0]).toMatchObject({ title: '', titleHidden: true });
  });
});

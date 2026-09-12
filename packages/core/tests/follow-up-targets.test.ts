import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { settings } from '../src/db/schema';
import { createFollowUp } from '../src/follow-ups/service';
import { listDueFollowUpsWithTargets, resolveFollowUpTarget } from '../src/follow-ups/targets';
import { defineModule } from '../src/modules/manifest';
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
});

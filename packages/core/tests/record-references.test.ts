import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { findModuleRecordReferences, findRecordReferences } from '../src/deletion-guards';
import { completeFollowUp, createFollowUp } from '../src/follow-ups/service';
import { defineModule } from '../src/modules/manifest';
import { unwrap } from '../src/result';
import { writeSettingInternal } from '../src/settings/service';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const enable = (deps: ReturnType<typeof createTestDeps>, keys: string[]) =>
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', keys, 'test.enable');
  });

describe('findRecordReferences', () => {
  it('meldet eine offene Wiedervorlage, eine erledigte nicht', async () => {
    const deps = createTestDeps({ now: '2026-09-17T08:00:00.000Z' });
    const ctx = ctxWith(['followUps.view', 'followUps.manage'], insertUser(deps, {}));
    const open = unwrap(await createFollowUp(deps, ctx, { entityType: 'animal', entityId: 'A1', dueAt: '2026-10-01', title: 'Impfpass nachfragen' }));
    const done = unwrap(await createFollowUp(deps, ctx, { entityType: 'animal', entityId: 'A1', dueAt: '2026-10-02', title: 'Erledigt' }));
    unwrap(await completeFollowUp(deps, ctx, { id: done.id }));

    const refs = findRecordReferences(deps, 'animal', 'A1');
    expect(refs).toEqual([{ label: 'Wiedervorlage „Impfpass nachfragen“', entity: 'followUp', id: open.id }]);
    expect(findRecordReferences(deps, 'animal', 'A2')).toEqual([]);
    expect(findRecordReferences(deps, 'project', 'A1')).toEqual([]);
  });

  it('fragt jedes aktive Modul und kein deaktiviertes', () => {
    const probe = defineModule({
      key: 'probe',
      version: '0.0.0',
      permissions: [],
      recordReferences: (_deps, entityType, id) => (entityType === 'animal' ? [{ label: 'Dokument X', entity: 'document', id: `D-${id}`, href: '/dms/D' }] : []),
    });
    const deps = createTestDeps({ manifests: [coreModule, probe] });
    expect(findRecordReferences(deps, 'animal', 'A1')).toEqual([]);
    enable(deps, ['probe']);
    expect(findRecordReferences(deps, 'animal', 'A1')).toEqual([{ label: 'Dokument X', entity: 'document', id: 'D-A1', href: '/dms/D' }]);
  });

  it('reicht einen werfenden Haken durch — ein defekter Haken gibt nichts frei', () => {
    const broken = defineModule({
      key: 'broken',
      version: '0.0.0',
      permissions: [],
      recordReferences: () => {
        throw new Error('kaputt');
      },
    });
    const deps = createTestDeps({ manifests: [coreModule, broken] });
    enable(deps, ['broken']);
    expect(() => findRecordReferences(deps, 'animal', 'A1')).toThrow('kaputt');
  });

  it('findModuleRecordReferences leaves the core’s own follow-ups out', async () => {
    const probe = defineModule({
      key: 'probe',
      version: '0.0.0',
      permissions: [],
      recordReferences: (_deps, entityType, id) => (entityType === 'animal' ? [{ label: 'Dokument X', entity: 'probeRef', id: `D-${id}` }] : []),
    });
    const deps = createTestDeps({ manifests: [coreModule, probe], now: '2026-09-17T08:00:00.000Z' });
    enable(deps, ['probe']);
    const ctx = ctxWith(['followUps.view', 'followUps.manage'], insertUser(deps, {}));
    await createFollowUp(deps, ctx, { entityType: 'animal', entityId: 'A1', dueAt: '2026-10-01', title: 'Impfpass nachfragen' });

    expect(findRecordReferences(deps, 'animal', 'A1').map((r) => r.entity).sort()).toEqual(['followUp', 'probeRef']);
    expect(findModuleRecordReferences(deps, 'animal', 'A1').map((r) => r.entity)).toEqual(['probeRef']);
  });
});

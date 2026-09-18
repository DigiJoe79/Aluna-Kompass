import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { blockingHolds, buildDeletionPreview, deletionConflict } from '../src/deletion-guards';
import { defineModule } from '../src/modules/manifest';
import { writeSettingInternal } from '../src/settings/service';
import { createTestDeps, ctxWith } from '../src/testing';

/** Hält A-RUNNING bis 2036, A-EXPIRED bis 2020, A-PERMANENT dauerhaft; zeigt auf A-LINKED. */
const probe = defineModule({
  key: 'probe',
  version: '0.0.0',
  permissions: [],
  retentionHolds: (_deps, _type, id) =>
    id === 'A-RUNNING'
      ? [{ label: 'Vertrag V-1', until: '2036-12-31', entity: 'document', id: 'D1' }]
      : id === 'A-EXPIRED'
        ? [{ label: 'Alter Brief', until: '2020-12-31', entity: 'document', id: 'D2' }]
        : id === 'A-PERMANENT'
          ? [{ label: 'Satzung', until: null, entity: 'document', id: 'D3' }]
          : [],
  recordReferences: (_deps, _type, id) => (id === 'A-LINKED' ? [{ label: 'Dokument „Entwurf“', entity: 'document', id: 'D4', href: '/dms/D4' }] : []),
});

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, probe], now: '2026-09-17T08:00:00.000Z' });
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['probe'], 'test.enable');
  });
  return deps;
}
const subject = (id: string, isPublished = false) => ({ entityType: 'animal', id, isPublished, assetIds: [] });
const code = (f: ReturnType<typeof deletionConflict>) => (f && f.error.type === 'conflict' ? f.error.code : null);

describe('blockingHolds', () => {
  it('zählt laufende und dauerhafte Halter, abgelaufene nicht', () => {
    const deps = setup();
    expect(blockingHolds(deps, 'animal', 'A-RUNNING').map((h) => h.label)).toEqual(['Vertrag V-1']);
    expect(blockingHolds(deps, 'animal', 'A-PERMANENT').map((h) => h.label)).toEqual(['Satzung']);
    expect(blockingHolds(deps, 'animal', 'A-EXPIRED')).toEqual([]);
    expect(blockingHolds(deps, 'animal', 'A-FREE')).toEqual([]);
  });
});

describe('buildDeletionPreview and deletionConflict', () => {
  it('ist frei, wenn nichts dagegen spricht — auch ganz ohne Halter', () => {
    const preview = buildDeletionPreview(setup(), subject('A-FREE'));
    expect(preview).toEqual({ isPublished: false, holds: [], references: [], media: [], deletable: true });
    expect(deletionConflict(preview)).toBeNull();
  });

  it('lehnt Veröffentlichtes zuerst ab', () => {
    const preview = buildDeletionPreview(setup(), subject('A-RUNNING', true));
    expect(preview.deletable).toBe(false);
    expect(code(deletionConflict(preview))).toBe('stillPublished');
  });

  it('nennt den Halter mit Frist hinter dem Doppelpunkt', () => {
    const failure = deletionConflict(buildDeletionPreview(setup(), subject('A-RUNNING')));
    expect(code(failure)).toBe('recordHeld');
    expect(failure!.error.type === 'conflict' && failure!.error.message).toBe('Noch gehalten von: Vertrag V-1 (bis 2036-12-31)');
    const permanent = deletionConflict(buildDeletionPreview(setup(), subject('A-PERMANENT')));
    expect(permanent!.error.type === 'conflict' && permanent!.error.message).toBe('Noch gehalten von: Satzung (dauerhaft)');
  });

  it('nennt den Verweis', () => {
    const preview = buildDeletionPreview(setup(), subject('A-LINKED'));
    expect(preview.references).toHaveLength(1);
    const failure = deletionConflict(preview);
    expect(code(failure)).toBe('stillReferenced');
    expect(failure!.error.type === 'conflict' && failure!.error.message).toBe('Es zeigt noch darauf: Dokument „Entwurf“');
  });

  it('lässt einen abgelaufenen Halter durch', () => {
    expect(deletionConflict(buildDeletionPreview(setup(), subject('A-EXPIRED')))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  AI_LABELING_ENABLED_KEY,
  coreModule,
  derivedAssetId,
  listMediaAssets,
  setSetting,
  storeMediaAsset,
  unwrap,
} from '../src';
import { mediaAssets, auditLog } from '../src/db/schema';
import { aiKindOfInternal, setMediaAiKind } from '../src/media/ai-kind';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';

const PNG_BYTES = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);

const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule] });
  insertUser(deps, { id: 'USER-TEST' });
  const adminCtx = ctxWith(['settings.manage', 'media.upload']);
  unwrap(await setSetting(deps, adminCtx, { key: AI_LABELING_ENABLED_KEY, value: true }));
  const stored = unwrap(await storeMediaAsset(deps, adminCtx, { originalName: 'test.png', bytes: PNG_BYTES }));
  return { deps, adminCtx, asset: stored };
};

describe('setMediaAiKind', () => {
  it('sets the kind and records who changed it', async () => {
    const { deps, adminCtx, asset } = await setup();
    const result = unwrap(await setMediaAiKind(deps, adminCtx, { id: asset.id, aiKind: 'edited' }));
    expect(result.changed).toBe(true);

    const updated = deps.db.select().from(mediaAssets).all().find((a) => a.id === asset.id);
    expect(updated?.aiKind).toBe('edited');

    const entries = deps.db.select().from(auditLog).all().filter((e) => e.action === 'media.aiKind');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'media.aiKind',
      entityType: 'mediaAsset',
      entityId: asset.id,
      before: JSON.stringify({ aiKind: 'none' }),
      after: JSON.stringify({ aiKind: 'edited' }),
      params: JSON.stringify({ filename: asset.filename, aiKind: 'edited' }),
    });
  });

  it('does nothing and records nothing when the kind is unchanged', async () => {
    const { deps, adminCtx, asset } = await setup();
    const result = unwrap(await setMediaAiKind(deps, adminCtx, { id: asset.id, aiKind: 'none' }));
    expect(result.changed).toBe(false);

    const entries = deps.db.select().from(auditLog).all().filter((e) => e.action === 'media.aiKind');
    expect(entries).toHaveLength(0);
  });

  it('sets the original when given a derived id', async () => {
    const { deps, adminCtx, asset } = await setup();
    const derived = derivedAssetId(asset.id, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    const result = unwrap(await setMediaAiKind(deps, adminCtx, { id: derived, aiKind: 'generated' }));
    expect(result.changed).toBe(true);

    const updated = deps.db.select().from(mediaAssets).all().find((a) => a.id === asset.id);
    expect(updated?.aiKind).toBe('generated');
  });

  it('rejects while AI labeling is switched off', async () => {
    const { deps, adminCtx, asset } = await setup();
    unwrap(await setSetting(deps, adminCtx, { key: AI_LABELING_ENABLED_KEY, value: false }));

    const result = await setMediaAiKind(deps, adminCtx, { id: asset.id, aiKind: 'edited' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('conflict');
      if (result.error.type === 'conflict') {
        expect(result.error.code).toBe('aiLabelingDisabled');
      }
    }
  });

  it('returns notFound for an unknown id', async () => {
    const { deps, adminCtx } = await setup();
    const result = await setMediaAiKind(deps, adminCtx, { id: '01J00000000000000000000000', aiKind: 'edited' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('notFound');
    }
  });

  it('rejects an unknown kind', async () => {
    const { deps, adminCtx, asset } = await setup();
    const result = await setMediaAiKind(deps, adminCtx, { id: asset.id, aiKind: 'invalid-kind' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('validation');
    }
  });

  it('requires media.upload', async () => {
    const { deps, asset } = await setup();
    const noPermCtx = ctxWith([]);
    const result = await setMediaAiKind(deps, noPermCtx, { id: asset.id, aiKind: 'edited' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('forbidden');
    }
  });

  it('aiKindOfInternal resolves a derived id', async () => {
    const { deps, adminCtx, asset } = await setup();
    unwrap(await setMediaAiKind(deps, adminCtx, { id: asset.id, aiKind: 'edited' }));

    const derived = derivedAssetId(asset.id, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    expect(aiKindOfInternal(deps.db, derived)).toBe('edited');
    expect(aiKindOfInternal(deps.db, asset.id)).toBe('edited');
    expect(aiKindOfInternal(deps.db, 'unknown-id')).toBe('none');
  });

  it('lists the kind in the library', async () => {
    const { deps, adminCtx, asset } = await setup();
    unwrap(await setMediaAiKind(deps, adminCtx, { id: asset.id, aiKind: 'edited' }));

    const items = unwrap(await listMediaAssets(deps, adminCtx, {}));
    const item = items.find((i) => i.record.id === asset.id);
    expect(item).toBeDefined();
    expect(item?.aiKind).toBe('edited');
    expect(item?.record.aiKind).toBe('edited');
  });
});

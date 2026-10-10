import { createMediaFolder, schema, setSetting, storeMediaAsset, unwrap, writeSettingInternal } from '@kompass/core';
import { auditEntry, ctxWith, systemContext } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  acceptProposal,
  animalOrigins,
  animalProposalImages,
  deleteAnimal,
  getAnimal,
  PROPOSAL_PHOTO_FOLDER_KEY,
  PROPOSALS_ENABLED_KEY,
  proposalsStatus,
  rejectProposal,
  replacePhotosTx,
  resolveDelistedNotice,
  setAnimalPublished,
  stageProposalImage,
  submitProposal,
  setAnimalPhotos,
  updateAnimal,
  withdrawProposal,
} from '../src';
import { animal, createInput, manager, managerMcp, png, proposalDeps, source, SOURCE_A } from './proposal-fixture';

const create = createInput;

describe('accepting a new animal', () => {
  it('creates the animal with the proposed values, moves chosen images into the media library folder, sets origin, final and publishes on request', async () => {
    const d = await proposalDeps();
    await setSetting(d, ctxWith(['settings.manage']), { key: PROPOSAL_PHOTO_FOLDER_KEY, value: 'Tierfotos' });
    unwrap(await createMediaFolder(d, manager, { path: 'Tierfotos' }));
    const i1 = unwrap(await stageProposalImage(d, source(), { originalName: 'a.png', bytes: await png(1), sourceRef: 'hb-1' })).imageId;
    const p = unwrap(await submitProposal(d, source(), { ...create(), photos: [{ imageId: i1, isPrimary: true, crop: { x: 0, y: 0.1, w: 1, h: 0.8 } }] })).proposal;
    const r = unwrap(await acceptProposal(d, manager, { id: p.id, publish: true }));
    expect(r.proposal).toMatchObject({ state: 'accepted', animalId: r.animalId, final: { animalId: r.animalId, isPublished: true, photos: [{ sourceRef: 'hb-1', position: 1, isPrimary: true, crop: { x: 0, y: 0.1, w: 1, h: 0.8 } }] } });
    const a = unwrap(await getAnimal(d, manager, r.animalId!));
    expect(a).toMatchObject({ name: 'Lotte', isPublished: true, photos: [{ sourceUserId: SOURCE_A, sourceRef: 'hb-1' }] });
    expect(d.db.select().from(schema.mediaAssets).all()).toMatchObject([{ folder: 'Tierfotos' }]);
    expect(d.db.select().from(animalOrigins).all()).toMatchObject([{ animalId: a.id, sourceUserId: SOURCE_A, externalRef: 'HB-100' }]);
    expect(d.db.select().from(animalProposalImages).all()).toMatchObject([{ filename: null, mediaId: a.photos[0]!.assetId }]);
    expect(JSON.parse(auditEntry(d, 'animals.proposal.accept').params!)).toEqual({ kind: 'create', name: 'Lotte', sourceKey: 'hb-100-v1' });
  });

  it('is acceptedWithChanges when the reviewer edits a value or leaves out an image', async () => {
    const d = await proposalDeps();
    const p1 = unwrap(await submitProposal(d, source(), create())).proposal;
    const r1 = unwrap(await acceptProposal(d, manager, { id: p1.id, values: { name: 'Lotta' } }));
    expect(r1.proposal).toMatchObject({ state: 'acceptedWithChanges', final: { values: { name: 'Lotta' }, isPublished: false } });
    expect(auditEntry(d, 'animals.proposal.acceptWithChanges')).toBeTruthy();
    const i1 = unwrap(await stageProposalImage(d, source(), { originalName: 'a.png', bytes: await png(1) })).imageId;
    const p2 = unwrap(await submitProposal(d, source(), create({ sourceKey: 'k2', externalRef: 'HB-200', photos: [{ imageId: i1 }] }))).proposal;
    const r2 = unwrap(await acceptProposal(d, manager, { id: p2.id, photos: [] }));
    expect(r2.proposal).toMatchObject({ state: 'acceptedWithChanges', final: { photos: [] } });
    expect(d.db.select().from(schema.mediaAssets).all()).toEqual([]);
  });
});

describe('accepting a change', () => {
  it('keeps a conflicting field and says so (MCP without explicit choice)', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const p = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u', animalId: a.id, values: { summary: { de: 'Vorschlag.' }, sizeCm: 55 } })).proposal;
    d.clock.advance(60_000);
    unwrap(await updateAnimal(d, manager, { id: a.id, summary: { de: 'Von Hand.' } }));
    const r = unwrap(await acceptProposal(d, managerMcp, { id: p.id }));
    expect(r.keptForConflict).toEqual(['summary']);
    expect(r.proposal).toMatchObject({ state: 'acceptedWithChanges', final: { values: { summary: { de: 'Von Hand.' }, sizeCm: 55 } } });
  });

  it('takes the proposal for a conflicting field when chosen explicitly, and refuses a field that was not proposed', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const p = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u', animalId: a.id, values: { summary: { de: 'Vorschlag.' } } })).proposal;
    unwrap(await updateAnimal(d, manager, { id: a.id, summary: { de: 'Von Hand.' } }));
    expect(await acceptProposal(d, manager, { id: p.id, fields: { name: 'proposal' } })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'fields.name', message: 'notProposed' }] } });
    const r = unwrap(await acceptProposal(d, manager, { id: p.id, fields: { summary: 'proposal' } }));
    expect(r).toMatchObject({ keptForConflict: [], proposal: { state: 'accepted', final: { values: { summary: { de: 'Vorschlag.' } } } } });
    expect(unwrap(await getAnimal(d, manager, a.id)).summary).toEqual({ de: 'Vorschlag.' });
  });

  it('asks for the adoption year when the proposed status is adopted', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const p = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u', animalId: a.id, values: { status: 'adopted' } })).proposal;
    expect(await acceptProposal(d, manager, { id: p.id })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'adoptedYear', message: 'required' }] } });
    unwrap(await acceptProposal(d, manager, { id: p.id, adoptedYear: 2026 }));
    expect(unwrap(await getAnimal(d, manager, a.id))).toMatchObject({ status: 'adopted', story: { adoptedYear: 2026 } });
  });

  it('applies the default photo plan: new in, source photo not named out, Kompass photo kept; marks review only through mcp with the setting on', async () => {
    for (const [ctx, marked] of [[managerMcp, true], [manager, false]] as const) {
      const d = await proposalDeps({ reviewOnMcpWrite: true });
      const a = await animal(d);
      const own = unwrap(await storeMediaAsset(d, manager, { originalName: 'own.png', bytes: await png(10) }));
      const old = unwrap(await storeMediaAsset(d, manager, { originalName: 'old.png', bytes: await png(11) }));
      const before = unwrap(await getAnimal(d, manager, a.id));
      d.db.transaction((tx) => replacePhotosTx(tx, d, manager, before, [{ assetId: old.id, isPrimary: true, source: { userId: SOURCE_A, ref: 'hb-old' } }, { assetId: own.id, isPrimary: false }]));
      const i1 = unwrap(await stageProposalImage(d, source(), { originalName: 'n.png', bytes: await png(12), sourceRef: 'hb-new' })).imageId;
      const p = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u', animalId: a.id, photos: [{ imageId: i1, isPrimary: true }] })).proposal;
      const r = unwrap(await acceptProposal(d, ctx, { id: p.id }));
      expect(r.proposal.state).toBe('accepted');
      const after = unwrap(await getAnimal(d, manager, a.id));
      expect(after.photos.map((ph) => [ph.sourceRef, ph.isPrimary])).toEqual([['hb-new', true], [null, false]]);
      expect(after.photos[1]!.assetId).toBe(own.id);
      expect(after.reviewRequestedAt !== null).toBe(marked);
    }
  });

  it('refuses more than 12 photos in the default plan with tooManyPhotos', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const assets: { id: string }[] = [];
    for (let i = 0; i < 12; i += 1) assets.push(unwrap(await storeMediaAsset(d, manager, { originalName: `k${i}.png`, bytes: await png(20 + i) })));
    const before = unwrap(await getAnimal(d, manager, a.id));
    d.db.transaction((tx) => replacePhotosTx(tx, d, manager, before, assets.map((m, i) => ({ assetId: m.id, isPrimary: i === 0 }))));
    const i1 = unwrap(await stageProposalImage(d, source(), { originalName: 'n.png', bytes: await png(99) })).imageId;
    const p = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u', animalId: a.id, photos: [{ imageId: i1 }] })).proposal;
    expect(await acceptProposal(d, manager, { id: p.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'tooManyPhotos', params: { count: 13, max: 12 } } });
  });

  it('refuses a stale expectedVersion', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const p = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u', animalId: a.id, values: { sizeCm: 50 } })).proposal;
    expect(await acceptProposal(d, manager, { id: p.id, expectedVersion: 'alt' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'staleVersion' } });
  });
});

describe('accept details (deferred findings of plan A)', () => {
  it('takes adoptedYear from values as well; input.adoptedYear wins', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const p = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u', animalId: a.id, values: { status: 'adopted' } })).proposal;
    unwrap(await acceptProposal(d, manager, { id: p.id, values: { adoptedYear: 2024 } }));
    expect(unwrap(await getAnimal(d, manager, a.id))).toMatchObject({ status: 'adopted', story: { adoptedYear: 2024 } });
    const b = await animal(d, { name: 'Bella' });
    const q = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'v', animalId: b.id, values: { status: 'adopted' } })).proposal;
    unwrap(await acceptProposal(d, manager, { id: q.id, values: { adoptedYear: 2024 }, adoptedYear: 2025 }));
    expect(unwrap(await getAnimal(d, manager, b.id))).toMatchObject({ story: { adoptedYear: 2025 } });
  });

  it('final.values of a new animal holds every value the reviewer set, not only the proposed ones (A28)', async () => {
    const d = await proposalDeps();
    const p = unwrap(await submitProposal(d, source(), create())).proposal;
    const r = unwrap(await acceptProposal(d, manager, { id: p.id, values: { location: 'germany', sizeCm: 45 } }));
    const after = unwrap(await getAnimal(d, manager, r.animalId!));
    expect(after).toMatchObject({ location: 'germany', sizeCm: 45 });
    expect(r.proposal.final?.values).toMatchObject({ name: 'Lotte', location: 'germany', sizeCm: 45 });
  });

  it('two images with the same bytes become one photo and keep the chosen title photo', async () => {
    const d = await proposalDeps();
    const i0 = unwrap(await stageProposalImage(d, source(), { originalName: 'a.png', bytes: await png(1), sourceRef: 'hb-a' })).imageId;
    const i1 = unwrap(await stageProposalImage(d, source(), { originalName: 'b.png', bytes: await png(2), sourceRef: 'hb-b' })).imageId;
    const i2 = unwrap(await stageProposalImage(d, source(), { originalName: 'c.png', bytes: await png(2), sourceRef: 'hb-c' })).imageId;
    const p = unwrap(await submitProposal(d, source(), { ...create(), photos: [{ imageId: i0 }, { imageId: i1 }, { imageId: i2, isPrimary: true }] })).proposal;
    const r = unwrap(await acceptProposal(d, manager, { id: p.id }));
    const after = unwrap(await getAnimal(d, manager, r.animalId!));
    expect(after.photos.map((ph) => [ph.sourceRef, ph.isPrimary])).toEqual([['hb-a', false], ['hb-b', true]]);
  });

  it('a new image with the bytes of a Kompass photo keeps that photo\'s origin and title flag', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const other = unwrap(await storeMediaAsset(d, manager, { originalName: 'o.png', bytes: await png(30) }));
    const own = unwrap(await storeMediaAsset(d, manager, { originalName: 'k.png', bytes: await png(31) }));
    unwrap(await setAnimalPhotos(d, manager, { id: a.id, photos: [{ assetId: own.id, isPrimary: true }, { assetId: other.id, isPrimary: false }] }));
    const i1 = unwrap(await stageProposalImage(d, source(), { originalName: 'n.png', bytes: await png(31), sourceRef: 'hb-dup' })).imageId;
    const p = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u', animalId: a.id, photos: [{ mediaId: other.id }, { imageId: i1 }] })).proposal;
    unwrap(await acceptProposal(d, manager, { id: p.id }));
    const after = unwrap(await getAnimal(d, manager, a.id));
    const kept = after.photos.find((ph) => ph.assetId === own.id)!;
    expect(kept).toMatchObject({ isPrimary: true, sourceUserId: null, sourceRef: null });
    expect(after.photos.filter((ph) => ph.isPrimary)).toHaveLength(1);
  });
});

describe('notice, match, reject, delisted, deleted animal', () => {
  it('acknowledges a notice without touching the animal', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const p = unwrap(await submitProposal(d, source(), { kind: 'notice', sourceKey: 'n', animalId: a.id, reason: 'Fotos veraltet.' })).proposal;
    d.clock.advance(60_000);
    expect(unwrap(await acceptProposal(d, manager, { id: p.id })).proposal).toMatchObject({ state: 'accepted', final: null });
    expect(unwrap(await getAnimal(d, manager, a.id)).updatedAt).toBe(a.updatedAt);
  });

  it('needs sameAsAnswer for a match; same links the origin, different does not', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const p = unwrap(await submitProposal(d, source(), { kind: 'sameAs', sourceKey: 's', animalId: a.id, externalRef: 'HB-5', reason: 'Gleiche Fotos.' })).proposal;
    expect(await acceptProposal(d, manager, { id: p.id })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'sameAsAnswer', message: 'required' }] } });
    expect(unwrap(await acceptProposal(d, manager, { id: p.id, sameAsAnswer: 'same' })).proposal).toMatchObject({ state: 'accepted', sameAsAnswer: 'same', final: { animalId: a.id } });
    expect(d.db.select().from(animalOrigins).all()).toMatchObject([{ animalId: a.id, externalRef: 'HB-5' }]);
    const q = unwrap(await submitProposal(d, source(), { kind: 'sameAs', sourceKey: 's2', animalId: a.id, externalRef: 'HB-6', reason: 'Ähnlich.' })).proposal;
    expect(unwrap(await acceptProposal(d, manager, { id: q.id, sameAsAnswer: 'different' })).proposal).toMatchObject({ state: 'accepted', sameAsAnswer: 'different', final: { animalId: null } });
    expect(d.db.select().from(animalOrigins).all()).toHaveLength(1);
  });

  it('moves an existing origin of that externalRef to the matched animal', async () => {
    const d = await proposalDeps();
    const x = await animal(d, { name: 'Xaver' });
    const y = await animal(d, { name: 'Yuki' });
    d.db.insert(animalOrigins).values({ id: 'O1', animalId: x.id, sourceUserId: SOURCE_A, externalRef: 'HB-7', externalUrl: null, createdAt: 't', updatedAt: 't' }).run();
    const p = unwrap(await submitProposal(d, source(), { kind: 'sameAs', sourceKey: 's', animalId: y.id, externalRef: 'HB-7', reason: 'Doch dieser.' })).proposal;
    unwrap(await acceptProposal(d, manager, { id: p.id, sameAsAnswer: 'same' }));
    expect(d.db.select().from(animalOrigins).all()).toMatchObject([{ animalId: y.id, externalRef: 'HB-7' }]);
  });

  it('rejects with an optional note, deletes the staged files, leaves nothing in the media library', async () => {
    const d = await proposalDeps();
    const i1 = unwrap(await stageProposalImage(d, source(), { originalName: 'a.png', bytes: await png(1) })).imageId;
    const p = unwrap(await submitProposal(d, source(), { ...create(), photos: [{ imageId: i1 }] })).proposal;
    const file = d.db.select().from(animalProposalImages).get()!.filename!;
    expect(unwrap(await rejectProposal(d, manager, { id: p.id, note: 'Kein Hund für uns.' }))).toMatchObject({ state: 'rejected', decisionNote: 'Kein Hund für uns.' });
    expect(await d.files('animals').exists(file)).toBe(false);
    expect(d.db.select().from(schema.mediaAssets).all()).toEqual([]);
    expect(JSON.parse(auditEntry(d, 'animals.proposal.reject').params!)).toEqual({ kind: 'create', name: 'Lotte', sourceKey: 'hb-100-v1' });
  });

  it('resolves a delisted notice in one step and skips what is done', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    unwrap(await setAnimalPublished(d, manager, { id: a.id, isPublished: true }));
    const p = unwrap(await submitProposal(d, source(), { kind: 'notice', sourceKey: 'n1', animalId: a.id, reason: 'Nicht mehr gelistet.', noticeKind: 'delisted' })).proposal;
    expect(unwrap(await resolveDelistedNotice(d, manager, { id: p.id }))).toMatchObject({ steps: ['status', 'unpublish'], proposal: { state: 'accepted' } });
    expect(unwrap(await getAnimal(d, manager, a.id))).toMatchObject({ status: 'adopted', isPublished: false, story: { adoptedYear: 2026 } });
    const b = await animal(d, { name: 'Bodo' });
    const q = unwrap(await submitProposal(d, source(), { kind: 'notice', sourceKey: 'n2', animalId: b.id, reason: 'Weg.', noticeKind: 'delisted' })).proposal;
    expect(unwrap(await resolveDelistedNotice(d, manager, { id: q.id })).steps).toEqual(['status']);
    const plain = unwrap(await submitProposal(d, source(), { kind: 'notice', sourceKey: 'n3', animalId: b.id, reason: 'Anderes.' })).proposal;
    expect(await resolveDelistedNotice(d, manager, { id: plain.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'notDelisted' } });
  });

  it('rejects open proposals of a deleted animal with reason animalDeleted and drops its origins', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const p = unwrap(await submitProposal(d, source(), { kind: 'notice', sourceKey: 'n', animalId: a.id, reason: 'x' })).proposal;
    d.db.insert(animalOrigins).values({ id: 'O1', animalId: a.id, sourceUserId: SOURCE_A, externalRef: 'HB-1', externalUrl: null, createdAt: 't', updatedAt: 't' }).run();
    unwrap(await deleteAnimal(d, manager, { id: a.id }));
    expect(unwrap(await proposalsStatus(d, source(), {})).proposals[0]).toMatchObject({ id: p.id, state: 'rejected', decisionReason: 'animalDeleted', animalId: a.id });
    expect(d.db.select().from(animalOrigins).all()).toEqual([]);
  });

  it('a source can neither accept nor reject; the setting off still lets a manager decide open proposals', async () => {
    const d = await proposalDeps();
    const p = unwrap(await submitProposal(d, source(), create())).proposal;
    expect(await acceptProposal(d, source(), { id: p.id })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'animals.manage' } });
    expect(await rejectProposal(d, source(), { id: p.id })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'animals.manage' } });
    d.db.transaction((tx) => unwrap(writeSettingInternal(tx, d, systemContext(), PROPOSALS_ENABLED_KEY, false)));
    expect((await acceptProposal(d, manager, { id: p.id })).ok).toBe(true);
    expect(d.db.select().from(animalProposalImages).where(eq(animalProposalImages.proposalId, p.id)).all()).toEqual([]);
  });
});

describe('accepting while something changes in between', () => {
  it('refuses when the proposal was withdrawn while the images were stored, and creates no animal', async () => {
    const d = await proposalDeps();
    const i1 = unwrap(await stageProposalImage(d, source(), { originalName: 'a.png', bytes: await png(1) })).imageId;
    const p = unwrap(await submitProposal(d, source(), { ...create(), photos: [{ imageId: i1 }] })).proposal;
    const racing = {
      ...d,
      files: (key: string) => {
        const store = d.files(key);
        return { ...store, read: async (name: string) => { const bytes = await store.read(name); unwrap(await withdrawProposal(d, source(), { sourceKey: 'hb-100-v1', reason: 'doch nicht' })); return bytes; } };
      },
    };
    expect(await acceptProposal(racing, manager, { id: p.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'proposalNotOpen' } });
    expect(d.db.select().from(schema.mediaAssets).all()).toHaveLength(1); // die Mediathek räumt es weg, sobald jemand es braucht
    expect(unwrap(await proposalsStatus(d, source(), {})).proposals[0]).toMatchObject({ state: 'withdrawn' });
    expect(d.db.select().from(animalOrigins).all()).toEqual([]);
  });

  it('refuses a proposed photo that no longer exists instead of failing on the database', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const m = unwrap(await storeMediaAsset(d, manager, { originalName: 'm.png', bytes: await png(5) }));
    unwrap(await setAnimalPhotos(d, manager, { id: a.id, photos: [{ assetId: m.id, isPrimary: true }] }));
    const p = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u', animalId: a.id, photos: [{ mediaId: m.id, isPrimary: true }] })).proposal;
    unwrap(await setAnimalPhotos(d, manager, { id: a.id, photos: [] }));
    d.db.delete(schema.mediaAssets).where(eq(schema.mediaAssets.id, m.id)).run();
    expect(await acceptProposal(d, manager, { id: p.id })).toMatchObject({ ok: false, error: { type: 'notFound', entity: 'mediaAsset', id: m.id } });
  });
});

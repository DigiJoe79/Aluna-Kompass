import { unwrap, writeSettingInternal } from '@kompass/core';
import { auditEntry, systemContext } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { animalOrigins, animalProposalImages, animalProposals, PROPOSALS_ENABLED_KEY, proposalsStatus, stageProposalImage, submitProposal, withdrawProposal } from '../src';
import { animal, createInput, png, proposalDeps, source, SOURCE_A, SOURCE_B } from './proposal-fixture';

const create = createInput;

describe('submitting proposals', () => {
  it('creates an open proposal, audits kind, name and sourceKey without content', async () => {
    const d = await proposalDeps();
    const r = unwrap(await submitProposal(d, source(), create()));
    expect(r).toMatchObject({ existing: false, replaced: [], proposal: { kind: 'create', state: 'open', sourceKey: 'hb-100-v1', externalRef: 'HB-100', final: null } });
    const entry = auditEntry(d, 'animals.proposal.submit');
    expect(JSON.parse(entry.params!)).toEqual({ kind: 'create', name: 'Lotte', sourceKey: 'hb-100-v1' });
    expect(entry.after ?? '').not.toContain('Fröhlich');
  });

  it('returns the existing proposal for a sourceKey already used, without a second row (A15)', async () => {
    const d = await proposalDeps();
    const first = unwrap(await submitProposal(d, source(), create()));
    const again = unwrap(await submitProposal(d, source(), create({ values: { ...create().values, name: 'Anders' } })));
    expect(again).toMatchObject({ existing: true, proposal: { id: first.proposal.id } });
    expect(d.db.select().from(animalProposals).all()).toHaveLength(1);
  });

  it('replaces the open update of the same source and animal, and the open create with the same externalRef (A14)', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u1', animalId: a.id, values: { sizeCm: 45 } }));
    const u2 = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u2', animalId: a.id, values: { sizeCm: 46 } }));
    expect(u2.replaced).toEqual(['u1']);
    expect(unwrap(await proposalsStatus(d, source(), { sourceKeys: ['u1'] })).proposals[0]).toMatchObject({ state: 'replaced', decidedAt: expect.any(String) });
    // Eine andere Quelle ersetzt nichts.
    expect(unwrap(await submitProposal(d, source(SOURCE_B), { kind: 'update', sourceKey: 'b1', animalId: a.id, values: { sizeCm: 47 } })).replaced).toEqual([]);
    unwrap(await submitProposal(d, source(), create()));
    expect(unwrap(await submitProposal(d, source(), create({ sourceKey: 'hb-100-v2' }))).replaced).toEqual(['hb-100-v1']);
    expect(auditEntry(d, 'animals.proposal.replace')).toBeTruthy();
  });

  it('replacing keeps an image the new proposal reuses and deletes the others', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const i1 = unwrap(await stageProposalImage(d, source(), { originalName: 'a.png', bytes: await png(1) })).imageId;
    const i2 = unwrap(await stageProposalImage(d, source(), { originalName: 'b.png', bytes: await png(2) })).imageId;
    unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u1', animalId: a.id, photos: [{ imageId: i1 }, { imageId: i2 }] }));
    const file2 = d.db.select().from(animalProposalImages).where(eq(animalProposalImages.id, i2)).get()!.filename!;
    const next = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u2', animalId: a.id, photos: [{ imageId: i1, isPrimary: true }] }));
    const rows = d.db.select().from(animalProposalImages).all();
    expect(rows.find((r) => r.id === i1)).toMatchObject({ proposalId: next.proposal.id, isPrimary: true, filename: expect.any(String) });
    expect(rows.find((r) => r.id === i2)).toMatchObject({ filename: null });
    expect(await d.files('animals').exists(rows.find((r) => r.id === i1)!.filename!)).toBe(true);
    expect(await d.files('animals').exists(file2)).toBe(false);
  });

  it('refuses a staged image of another source, an image already in another open proposal, a mediaId that is no photo of the animal, and mediaId on a new animal', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const b = await animal(d, { name: 'Bella' });
    const foreign = unwrap(await stageProposalImage(d, source(SOURCE_B), { originalName: 'a.png', bytes: await png(1) })).imageId;
    expect(await submitProposal(d, source(), { kind: 'update', sourceKey: 'x1', animalId: a.id, photos: [{ imageId: foreign }] })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'proposalImageUnavailable' } });
    const own = unwrap(await stageProposalImage(d, source(), { originalName: 'b.png', bytes: await png(2) })).imageId;
    unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'x0', animalId: b.id, photos: [{ imageId: own }] }));
    expect(await submitProposal(d, source(), { kind: 'update', sourceKey: 'x3', animalId: a.id, photos: [{ imageId: own }] })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'proposalImageUnavailable' } });
    expect(await submitProposal(d, source(), { kind: 'update', sourceKey: 'x2', animalId: a.id, photos: [{ mediaId: 'NICHT-AM-TIER' }] })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'photos.0.mediaId', message: 'notAnimalPhoto' }] } });
    expect(await submitProposal(d, source(), create({ photos: [{ mediaId: 'M' }] }))).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'photos.0.mediaId', message: 'mediaNotAllowed' }] } });
  });

  it('refuses an empty update, a missing animal, a create for an externalRef that already has an animal', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    expect(await submitProposal(d, source(), { kind: 'update', sourceKey: 'e', animalId: a.id })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'values', message: 'emptyProposal' }] } });
    expect(await submitProposal(d, source(), { kind: 'notice', sourceKey: 'n', animalId: 'FEHLT', reason: 'x' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    d.db.insert(animalOrigins).values({ id: 'O1', animalId: a.id, sourceUserId: SOURCE_A, externalRef: 'HB-100', externalUrl: null, createdAt: 't', updatedAt: 't' }).run();
    expect(await submitProposal(d, source(), create())).toMatchObject({ ok: false, error: { type: 'conflict', code: 'originExists', params: { animalId: a.id } } });
  });

  it('stores the baseline of the proposed fields and of photos', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const r = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'b', animalId: a.id, values: { summary: { de: 'Neu.' }, status: 'reserved' }, photos: [] }));
    expect(d.db.select().from(animalProposals).where(eq(animalProposals.id, r.proposal.id)).get()!.baseline).toEqual({ summary: a.summary, status: 'lookingForHome', photos: [] });
  });

  it('withdraws only an own open proposal, with a reason; the setting off still lets a source withdraw and read', async () => {
    const d = await proposalDeps();
    unwrap(await submitProposal(d, source(), create()));
    expect(await withdrawProposal(d, source(SOURCE_B), { sourceKey: 'hb-100-v1', reason: 'x' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    d.db.transaction((tx) => unwrap(writeSettingInternal(tx, d, systemContext(), PROPOSALS_ENABLED_KEY, false)));
    expect(await submitProposal(d, source(), create({ sourceKey: 'neu' }))).toMatchObject({ ok: false, error: { code: 'proposalsDisabled' } });
    expect(unwrap(await withdrawProposal(d, source(), { sourceKey: 'hb-100-v1', reason: 'doch vermittelt' }))).toMatchObject({ state: 'withdrawn', decisionNote: 'doch vermittelt' });
    expect(await withdrawProposal(d, source(), { sourceKey: 'hb-100-v1', reason: 'noch mal' })).toMatchObject({ ok: false, error: { code: 'proposalNotOpen' } });
    expect(unwrap(await proposalsStatus(d, source(), {})).proposals).toHaveLength(1);
  });

  it('status shows a source only its own proposals, filtered by sourceKeys and since', async () => {
    const d = await proposalDeps();
    unwrap(await submitProposal(d, source(), create()));
    unwrap(await submitProposal(d, source(SOURCE_B), create({ sourceKey: 'b-1', externalRef: 'B-1' })));
    expect(unwrap(await proposalsStatus(d, source(), {})).proposals.map((p) => p.sourceKey)).toEqual(['hb-100-v1']);
    expect(unwrap(await proposalsStatus(d, source(), { sourceKeys: ['b-1'] })).proposals).toEqual([]);
    d.clock.advance(60_000);
    expect(unwrap(await proposalsStatus(d, source(), { since: d.clock.now().toISOString() })).proposals).toEqual([]);
  });
});

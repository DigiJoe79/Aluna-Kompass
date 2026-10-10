import { runHousekeeping, schema, unwrap } from '@kompass/core';
import { auditEntry } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { acceptProposal, animalProposalImages, animalProposals, getAnimal, proposalsStatus, stageProposalImage, submitProposal, sweepProposals } from '../src';
import { createInput, manager, png, proposalDeps, source } from './proposal-fixture';

describe('sweeping proposals', () => {
  it('removes staged images without a proposal after 24 hours, not before', async () => {
    const d = await proposalDeps();
    const { imageId } = unwrap(await stageProposalImage(d, source(), { originalName: 'a.png', bytes: await png(1) }));
    const file = d.db.select().from(animalProposalImages).get()!.filename!;
    d.clock.advance(23 * 3_600_000);
    expect((await sweepProposals(d)).stagedRemoved).toBe(0);
    d.clock.advance(2 * 3_600_000);
    expect(await sweepProposals(d)).toMatchObject({ stagedRemoved: 1 });
    expect(await d.files('animals').exists(file)).toBe(false);
    expect(d.db.select().from(animalProposalImages).where(eq(animalProposalImages.id, imageId)).get()).toBeUndefined();
    expect(JSON.parse(auditEntry(d, 'animals.proposal.clear').params!)).toEqual({ proposals: 0, images: 1 });
  });

  it('deletes files left on decided proposals (e.g. after a crash between commit and file deletion)', async () => {
    const d = await proposalDeps();
    const { imageId } = unwrap(await stageProposalImage(d, source(), { originalName: 'a.png', bytes: await png(1) }));
    const p = unwrap(await submitProposal(d, source(), createInput({ photos: [{ imageId }] }))).proposal;
    const file = d.db.select().from(animalProposalImages).get()!.filename!;
    d.db.update(animalProposals).set({ state: 'rejected' }).where(eq(animalProposals.id, p.id)).run();
    expect(await sweepProposals(d)).toMatchObject({ filesRemoved: 1 });
    expect(await d.files('animals').exists(file)).toBe(false);
    expect(d.db.select().from(animalProposalImages).get()).toMatchObject({ id: imageId, filename: null });
  });

  it('clears content 90 days after the decision and keeps state, time and reason', async () => {
    const d = await proposalDeps();
    const { imageId } = unwrap(await stageProposalImage(d, source(), { originalName: 'a.png', bytes: await png(1) }));
    const p = unwrap(await submitProposal(d, source(), createInput({ photos: [{ imageId, isPrimary: true }] }))).proposal;
    const { animalId, proposal } = unwrap(await acceptProposal(d, manager, { id: p.id }));
    d.clock.advance(89 * 86_400_000);
    expect((await sweepProposals(d)).cleared).toBe(0);
    d.clock.advance(2 * 86_400_000);
    expect((await sweepProposals(d)).cleared).toBe(1);
    expect(d.db.select().from(animalProposals).get()).toMatchObject({ values: null, hints: null, baseline: null, final: null, clearedAt: expect.any(String), state: 'accepted', decidedAt: proposal.decidedAt });
    expect(d.db.select().from(animalProposalImages).all()).toEqual([]);
    expect(unwrap(await proposalsStatus(d, source(), {})).proposals[0]).toMatchObject({ cleared: true, final: null, state: 'accepted' });
    expect(unwrap(await getAnimal(d, manager, animalId!)).photos).toHaveLength(1);
    expect(d.db.select().from(schema.mediaAssets).all()).toHaveLength(1);
  });

  it('writes no audit entry when nothing happened, and runs through the module hook', async () => {
    const d = await proposalDeps();
    expect(await runHousekeeping(d)).toEqual([{ module: 'animals', error: null }]);
    expect(() => auditEntry(d, 'animals.proposal.clear')).toThrow();
  });
});

import { schema, unwrap } from '@kompass/core';
import { auditEntry } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { readProposalImage, stageProposalImage } from '../src';
import { manager, png, proposalDeps, source, SOURCE_A } from './proposal-fixture';

describe('staging images', () => {
  it('stages a png in the module store, outside the media library, and audits without content', async () => {
    const d = await proposalDeps();
    const staged = await stageProposalImage(d, source(), { originalName: 'hb-1.png', bytes: await png(1), sourceRef: 'hb-1' });
    expect(staged).toMatchObject({ ok: true, value: { mimeType: 'image/png', width: 4, height: 5, expiresAt: '2026-09-06T08:00:00.000Z' } });
    expect(d.db.select().from(schema.mediaAssets).all()).toEqual([]);
    expect(auditEntry(d, 'animals.proposal.stageImage')).toMatchObject({ userId: SOURCE_A, params: null, after: null });
  });
  it('refuses svg, a broken file and more than 10 MB', async () => {
    const d = await proposalDeps();
    expect(await stageProposalImage(d, source(), { originalName: 'x.svg', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>') })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'bytes', message: 'unsupportedMediaType' }] } });
    expect(await stageProposalImage(d, source(), { originalName: 'x.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'bytes', message: 'unsupportedMediaType' }] } });
    expect(await stageProposalImage(d, source(), { originalName: 'x.jpg', bytes: new Uint8Array(10 * 1024 * 1024 + 1) })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'bytes', message: 'fileTooLarge' }] } });
  });
  it('needs animals.propose and the setting on', async () => {
    expect((await stageProposalImage(await proposalDeps(), manager, { originalName: 'a.png', bytes: await png(1) })).ok).toBe(false); // manage ist nicht propose
    expect(await stageProposalImage(await proposalDeps({ proposals: false }), source(), { originalName: 'a.png', bytes: await png(1) })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'proposalsDisabled' } });
  });
  it('lets a manager read the bytes and a preview, not the source', async () => {
    const d = await proposalDeps();
    const { imageId } = unwrap(await stageProposalImage(d, source(), { originalName: 'a.png', bytes: await png(1) }));
    expect(await readProposalImage(d, manager, { imageId })).toMatchObject({ ok: true, value: { contentType: 'image/png' } });
    expect(await readProposalImage(d, manager, { imageId, variant: 'preview' })).toMatchObject({ ok: true, value: { contentType: 'image/webp' } });
    expect((await readProposalImage(d, source(), { imageId })).ok).toBe(false);
  });
});

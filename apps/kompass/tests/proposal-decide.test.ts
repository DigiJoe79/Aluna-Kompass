import { coreModule, listFollowUps, unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, systemContext, type TestDeps } from '@kompass/core/testing';
import { animalsModule, createAnimal, getProposal, PROPOSALS_ENABLED_KEY, rejectProposal, submitProposal } from '@kompass/module-animals';
import { beforeEach, describe, expect, it } from 'vitest';
import { acceptWithFollowUp } from '@/app/(shell)/animals/proposals/decide';

// Einrichtung wie packages/modules/animals/tests/proposal-fixture.ts (nicht über Paketgrenzen importiert).
const SOURCE = 'SOURCE-A';
const manager: CallContext = ctxWith(['animals.view', 'animals.manage', 'media.upload'], 'USER-TEST');
const withFollowUps: CallContext = ctxWith(['animals.view', 'animals.manage', 'media.upload', 'followUps.view', 'followUps.manage'], 'USER-TEST');
const source: CallContext = { ...ctxWith(['animals.view', 'animals.propose'], SOURCE), channel: 'mcp' };
const dog = { name: 'Luna', sex: 'female' as const, birthText: { de: '2022' }, sizeText: { de: '40 cm' }, summary: { de: 'Ruhig.' }, body: { de: 'Text' } };

let deps: TestDeps;
let createId: string;
let updateId: string;

beforeEach(async () => {
  deps = createTestDeps({ manifests: [coreModule, animalsModule], locales: ['de', 'en'] });
  insertUser(deps, { id: 'USER-TEST', name: 'Petra Prüferin' });
  insertUser(deps, { id: SOURCE, name: 'Tierbörse Nord' });
  deps.db.transaction((tx) => {
    unwrap(writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['animals']));
    unwrap(writeSettingInternal(tx, deps, systemContext(), PROPOSALS_ENABLED_KEY, true));
  });
  createId = unwrap(await submitProposal(deps, source, { kind: 'create', sourceKey: 'c1', externalRef: 'C1', values: { name: 'Lotte', sex: 'female', birthText: { de: '2021' }, sizeText: { de: 'mittel' }, summary: { de: 'Fröhlich.' }, body: { de: 'Lang.' } } })).proposal.id;
  const luna = unwrap(await createAnimal(deps, manager, dog));
  updateId = unwrap(await submitProposal(deps, source, { kind: 'update', sourceKey: 'u1', animalId: luna.id, values: { sizeCm: 44 } })).proposal.id;
});

describe('acceptWithFollowUp (Spec § 6, A26)', () => {
  it('accepts and then files the follow-up on the animal', async () => {
    const r = unwrap(await acceptWithFollowUp(deps, withFollowUps, { id: createId, followUp: { dueAt: '2026-10-24', title: ' Neue Fotos ansehen ' } }));
    expect(r).toMatchObject({ state: 'accepted', followUp: 'created' });
    const due = unwrap(await listFollowUps(deps, withFollowUps, { entityType: 'animal', entityId: r.animalId! }));
    expect(due.map((f) => f.title)).toEqual(['Neue Fotos ansehen']);
  });

  it('reports a new dog as accepted (not with changes) when the form sends only what changed, here nothing', async () => {
    expect(unwrap(await acceptWithFollowUp(deps, manager, { id: createId, values: {} }))).toMatchObject({ state: 'accepted' });
  });

  it('accepts without a follow-up when none is asked for, and says when one could not be filed', async () => {
    expect(unwrap(await acceptWithFollowUp(deps, manager, { id: updateId }))).toMatchObject({ followUp: null });
    const r = unwrap(await acceptWithFollowUp(deps, manager, { id: createId, followUp: { dueAt: '2026-10-24', title: 'x' } }));
    expect(r.followUp).toBe('refused');
  });

  it('files no follow-up when the acceptance is refused', async () => {
    unwrap(await rejectProposal(deps, manager, { id: createId }));
    const r = await acceptWithFollowUp(deps, withFollowUps, { id: createId, followUp: { dueAt: '2026-10-24', title: 'x' } });
    expect(r).toMatchObject({ ok: false, error: { type: 'conflict', code: 'proposalNotOpen' } });
  });

  it('passes the loaded version and refuses a stale animal', async () => {
    const r = await acceptWithFollowUp(deps, manager, { id: updateId, expectedVersion: '2000-01-01T00:00:00.000Z' });
    expect(r).toMatchObject({ ok: false, error: { type: 'conflict' } });
    expect(unwrap(await getProposal(deps, manager, updateId)).proposal.state).toBe('open');
  });

  it('rejects a follow-up without date or title before accepting', async () => {
    const r = await acceptWithFollowUp(deps, withFollowUps, { id: createId, followUp: { dueAt: '', title: ' ' } });
    expect(r).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'followUp.dueAt' }, { path: 'followUp.title' }] } });
    expect(unwrap(await getProposal(deps, manager, createId)).proposal.state).toBe('open');
  });
});

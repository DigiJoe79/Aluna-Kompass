import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsRecordLabels } from '../src/record-labels';
import { submitProposal } from '../src';
import { createInput, manager, proposalDeps, source } from './proposal-fixture';

/** Was alle Module zusagen (fremder Typ, ok, forbidden, missing), prüft `apps/kompass/tests/module-contracts.test.ts`. */
describe('animalsRecordLabels', () => {
  it('labels a proposal for a manager, neutral without animals.manage, missing for an unknown id', async () => {
    const d = await proposalDeps();
    const p = unwrap(await submitProposal(d, source(), createInput())).proposal;
    expect(animalsRecordLabels(d, manager, 'animalProposal', p.id)).toEqual({ state: 'ok', name: 'Lotte', href: `/animals/proposals/${p.id}`, label: { key: 'animals.records.proposal', params: { name: 'Lotte' } } });
    expect(animalsRecordLabels(d, ctxWith(['animals.view']), 'animalProposal', p.id)).toEqual({ label: { key: 'animals.records.forbidden' }, href: null, state: 'forbidden' });
    expect(animalsRecordLabels(d, manager, 'animalProposal', 'NOPE')).toEqual({ label: '', href: null, state: 'missing' });
  });
});

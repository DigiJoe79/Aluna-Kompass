import { unwrap, writeSettingInternal } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { statuteSuggestionInternal } from '../src/finance-sources/statute';
import { createStatuteDraft, registerStatute, updateStatute } from '../src/statutes';
import { receivedDocument, setupGovernance, type GovernanceDeps } from './helpers';

type Ctx = ReturnType<typeof setupGovernance>['ctx'];

async function statute(deps: GovernanceDeps, ctx: Ctx, resolvedOn: string[], opts: { registeredOn?: string; basedOnId?: string; documentId?: string } = {}) {
  const draft = unwrap(await createStatuteDraft(deps, ctx, opts.basedOnId ? { basedOnId: opts.basedOnId } : {}));
  unwrap(await updateStatute(deps, ctx, { id: draft.id, resolutions: resolvedOn.map((on) => ({ on, resolutionId: null })), ...(opts.documentId ? { documentId: opts.documentId } : {}) }));
  if (opts.registeredOn) unwrap(await registerStatute(deps, ctx, { id: draft.id, registeredOn: opts.registeredOn }));
  return draft.id;
}

describe('statute source for Anlage Gem (G7)', () => {
  it('Gründung 20.07., Änderung 05.09., eingetragen 17.09.: the latest resolution date of the valid stand, with its text', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-10-01T08:00:00.000Z' });
    const founding = await statute(deps, ctx, ['2026-07-20']);
    const text = await receivedDocument(deps, 'Satzung');
    const second = await statute(deps, ctx, ['2026-09-05'], { registeredOn: '2026-09-17', basedOnId: founding, documentId: text });
    expect(statuteSuggestionInternal(deps, deps.db, '2026-12-31')).toEqual({ statuteDate: '2026-09-05', documentId: text, source: { label: expect.stringContaining('2026-09-05'), href: `/governance/statutes/${second}` } });
  });

  it('without a valid stand or with Gremien off: null', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-10-01T08:00:00.000Z' });
    expect(statuteSuggestionInternal(deps, deps.db, '2026-12-31')).toBeNull();
    await statute(deps, ctx, ['2026-07-20'], { registeredOn: '2026-08-01' });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance', 'members']));
    expect(statuteSuggestionInternal(deps, deps.db, '2026-12-31')).toBeNull();
  });
});

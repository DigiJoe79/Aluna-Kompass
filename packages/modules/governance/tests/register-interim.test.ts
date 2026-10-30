import { schema, setSetting, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { followUpTitle } from '../src/follow-up-titles';
import { createRegisterFiling, updateRegisterFiling } from '../src/register/filings';
import { recordInterimOrder, resolveInterimOrder } from '../src/register/interim-orders';
import { governanceRegisterOccasions } from '../src/schema';
import { endTerm, listTerms } from '../src/terms';
import { auditOf, holders, officeOf, receivedDocument, setupGovernance } from './helpers';

async function filing() {
  const setup = setupGovernance();
  const { deps, ctx } = setup;
  await holders(deps, ctx, ['chair']);
  const [term] = unwrap(await listTerms(deps, ctx, { officeId: officeOf(deps, 'chair') }));
  unwrap(await endTerm(deps, ctx, { id: term!.id, until: '2026-05-31', reason: 'resigned', receivedOn: '2026-05-20' }));
  const [occasion] = deps.db.select().from(governanceRegisterOccasions).all();
  const created = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: occasion!.id }] }));
  return { ...setup, filingId: created.id };
}

describe('interim orders', () => {
  it('the follow-up title comes from the language table in the leading language, the day as TT.MM.JJJJ', async () => {
    const { deps, ctx, filingId } = await filing();
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['en', 'de'] }));
    unwrap(await updateRegisterFiling(deps, ctx, { id: filingId, notarizedOn: '2026-06-02', submittedOn: '2026-06-03' }));
    unwrap(await recordInterimOrder(deps, ctx, { filingId, on: '2026-08-17', deadline: '2026-09-14' }));
    const [followUp] = deps.db.select().from(schema.followUps).all();
    expect(followUp!.title).toBe(followUpTitle('en', 'interimOrder', { date: '17.08.2026' }));
    expect(followUp!.title).not.toBe(followUpTitle('de', 'interimOrder', { date: '17.08.2026' }));
    expect(followUp!.title).toContain('17.08.2026');
  });

  it('an interim order with deadline sets the state and a follow-up for the caller; resolving returns to submitted', async () => {
    const { deps, ctx, userId, filingId } = await filing();
    unwrap(await updateRegisterFiling(deps, ctx, { id: filingId, notarizedOn: '2026-06-02', submittedOn: '2026-06-03' }));
    const documentId = await receivedDocument(deps, 'Zwischenverfügung');
    const ordered = unwrap(await recordInterimOrder(deps, ctx, { filingId, on: '2026-08-17', deadline: '2026-09-14', documentId }));
    expect(ordered.state).toBe('interimOrder');
    expect(ordered.interimOrders).toEqual([{ on: '2026-08-17', deadline: '2026-09-14', documentId, resolvedOn: null, followUpId: expect.any(String) }]);
    const followUps = deps.db.select().from(schema.followUps).all();
    expect(followUps).toEqual([expect.objectContaining({ id: ordered.interimOrders[0]!.followUpId, entityType: 'governanceRegisterFiling', entityId: filingId, dueAt: '2026-09-14', assigneeUserId: userId })]);
    expect(auditOf(deps, 'governance.register.interimOrder').at(-1)!.params).toEqual({ on: '2026-08-17', deadline: '2026-09-14' });

    const resolved = unwrap(await resolveInterimOrder(deps, ctx, { filingId, index: 0, resolvedOn: '2026-09-01' }));
    expect(resolved.state).toBe('submitted');
    expect(resolved.interimOrders[0]!.resolvedOn).toBe('2026-09-01');
    expect(auditOf(deps, 'governance.register.interimResolved').at(-1)!.params).toEqual({ resolvedOn: '2026-09-01' });
    // W-12: Mit der Zwischenverfügung ist auch ihre Wiedervorlage erledigt.
    expect(deps.db.select().from(schema.followUps).all()[0]!.doneAt).not.toBeNull();
    expect(await resolveInterimOrder(deps, ctx, { filingId, index: 0, resolvedOn: '2026-09-02' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await resolveInterimOrder(deps, ctx, { filingId, index: 3, resolvedOn: '2026-09-02' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('without deadline no follow-up; before submission conflict filingNotSubmitted; refuses without manage', async () => {
    const { deps, ctx, userId, filingId } = await filing();
    expect(await recordInterimOrder(deps, ctx, { filingId, on: '2026-08-17' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'filingNotSubmitted' } });
    unwrap(await updateRegisterFiling(deps, ctx, { id: filingId, submittedOn: '2026-06-03' }));
    expect(await recordInterimOrder(deps, ctxWith(['governance.read'], userId), { filingId, on: '2026-08-17' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await recordInterimOrder(deps, ctx, { filingId, on: '2026-06-01' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(unwrap(await recordInterimOrder(deps, ctx, { filingId, on: '2026-08-17' })).interimOrders[0]!.followUpId).toBeNull();
    expect(deps.db.select().from(schema.followUps).all()).toEqual([]);
  });

  it('W-12: registration completes the follow-up of an open interim order; the follow-up links the filing', async () => {
    const { deps, ctx, filingId } = await filing();
    unwrap(await updateRegisterFiling(deps, ctx, { id: filingId, notarizedOn: '2026-06-02', submittedOn: '2026-06-03' }));
    unwrap(await recordInterimOrder(deps, ctx, { filingId, on: '2026-08-17', deadline: '2026-09-14' }));
    const { governanceRecordLabels } = await import('../src/record-labels');
    expect(governanceRecordLabels(deps, ctx, 'governanceRegisterFiling', filingId)!.href).toBe(`/governance/register/${filingId}`);
    const { completeRegisterFiling } = await import('../src/register/complete');
    unwrap(await completeRegisterFiling(deps, ctx, { filingId, registeredOn: '2026-08-30' }));
    expect(deps.db.select().from(schema.followUps).all()[0]!.doneAt).not.toBeNull();
  });
});

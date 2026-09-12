import { describe, expect, it } from 'vitest';
import { auditLog, followUps } from '../src/db/schema';
import {
  completeFollowUp,
  createFollowUp,
  deleteFollowUp,
  deleteFollowUpsFor,
  listDueFollowUps,
  listFollowUps,
  reopenFollowUp,
} from '../src/follow-ups/service';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const ALL = ['followUps.view', 'followUps.manage'];

function setup() {
  const deps = createTestDeps({ now: '2026-09-12T08:00:00.000Z' });
  const userId = insertUser(deps, { name: 'Anna' });
  return { deps, ctx: ctxWith(ALL, userId), userId };
}

const actions = (deps: ReturnType<typeof setup>['deps']) => deps.db.select().from(auditLog).all().map((e) => e.action);

describe('createFollowUp', () => {
  it('legt eine offene Wiedervorlage an und protokolliert sie', async () => {
    const { deps, ctx, userId } = setup();
    const created = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'Antwort abwarten' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({ entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'Antwort abwarten', doneAt: null, createdByUserId: userId, assigneeUserId: null });
    expect(actions(deps)).toContain('followUps.create');
  });

  it('weist ohne Recht ab', async () => {
    const { deps } = setup();
    const denied = await createFollowUp(deps, ctxWith(['followUps.view']), { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'x' });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.type).toBe('forbidden');
  });

  it('weist ein kaputtes Datum und einen leeren Anlass ab', async () => {
    const { deps, ctx } = setup();
    const bad = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '20.09.2026', title: '' });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.type).toBe('validation');
  });

  it('nimmt eine zuständige Person nur, wenn es sie gibt', async () => {
    const { deps, ctx } = setup();
    const missing = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'x', assigneeUserId: 'NOBODY' });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.type).toBe('notFound');
  });
});

describe('completeFollowUp / reopenFollowUp', () => {
  it('hakt ab, merkt sich wer und wann, und lässt sich nicht zweimal abhaken', async () => {
    const { deps, ctx, userId } = setup();
    const created = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'x' });
    if (!created.ok) throw new Error('create');
    const done = await completeFollowUp(deps, ctx, { id: created.value.id });
    expect(done.ok && done.value.doneAt).toBe('2026-09-12T08:00:00.000Z');
    expect(done.ok && done.value.doneByUserId).toBe(userId);
    const again = await completeFollowUp(deps, ctx, { id: created.value.id });
    expect(!again.ok && again.error.type === 'conflict' && again.error.code).toBe('followUpDone');
    expect(actions(deps)).toContain('followUps.complete');
  });

  it('öffnet wieder und weist Wiederöffnen einer offenen ab', async () => {
    const { deps, ctx } = setup();
    const created = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'x' });
    if (!created.ok) throw new Error('create');
    const open = await reopenFollowUp(deps, ctx, { id: created.value.id });
    expect(!open.ok && open.error.type === 'conflict' && open.error.code).toBe('followUpOpen');
    await completeFollowUp(deps, ctx, { id: created.value.id });
    const reopened = await reopenFollowUp(deps, ctx, { id: created.value.id });
    expect(reopened.ok && reopened.value.doneAt).toBeNull();
    expect(actions(deps)).toContain('followUps.reopen');
  });

  it('meldet eine unbekannte Wiedervorlage', async () => {
    const { deps, ctx } = setup();
    const missing = await completeFollowUp(deps, ctx, { id: 'NOPE' });
    expect(!missing.ok && missing.error.type).toBe('notFound');
  });
});

describe('listFollowUps / listDueFollowUps', () => {
  it('listet je Vorgang offene zuerst, erledigte nur auf Wunsch', async () => {
    const { deps, ctx } = setup();
    const a = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-25', title: 'spät' });
    const b = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-15', title: 'früh' });
    const c = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-10', title: 'erledigt' });
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D2', dueAt: '2026-09-10', title: 'anderes' });
    if (!a.ok || !b.ok || !c.ok) throw new Error('create');
    await completeFollowUp(deps, ctx, { id: c.value.id });

    const open = await listFollowUps(deps, ctx, { entityType: 'document', entityId: 'D1' });
    expect(open.ok && open.value.map((f) => f.title)).toEqual(['früh', 'spät']);
    const all = await listFollowUps(deps, ctx, { entityType: 'document', entityId: 'D1', includeDone: true });
    expect(all.ok && all.value.map((f) => f.title)).toEqual(['früh', 'spät', 'erledigt']);
  });

  it('liefert die fälligen bis zu einem Datum, älteste zuerst, wahlweise nur für eine Person', async () => {
    const { deps, ctx, userId } = setup();
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-01', title: 'überfällig' });
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D2', dueAt: '2026-09-18', title: 'diese Woche', assigneeUserId: userId });
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D3', dueAt: '2026-10-30', title: 'später' });

    const due = await listDueFollowUps(deps, ctx, { until: '2026-09-19' });
    expect(due.ok && due.value.map((f) => f.title)).toEqual(['überfällig', 'diese Woche']);
    const mine = await listDueFollowUps(deps, ctx, { until: '2026-09-19', assigneeUserId: userId });
    expect(mine.ok && mine.value.map((f) => f.title)).toEqual(['diese Woche']);
  });

  it('braucht das Leserecht', async () => {
    const { deps } = setup();
    const denied = await listDueFollowUps(deps, ctxWith([]), { until: '2026-09-19' });
    expect(!denied.ok && denied.error.type).toBe('forbidden');
  });
});

describe('deleteFollowUp / deleteFollowUpsFor', () => {
  it('löscht eine einzelne mit Protokoll', async () => {
    const { deps, ctx } = setup();
    const created = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'x' });
    if (!created.ok) throw new Error('create');
    const deleted = await deleteFollowUp(deps, ctx, { id: created.value.id });
    expect(deleted.ok).toBe(true);
    expect(deps.db.select().from(followUps).all()).toHaveLength(0);
    expect(actions(deps)).toContain('followUps.delete');
  });

  it('räumt alle Wiedervorlagen eines Vorgangs weg, auch erledigte, ohne eigenen Protokolleintrag', async () => {
    const { deps, ctx } = setup();
    const a = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'a' });
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-21', title: 'b' });
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D2', dueAt: '2026-09-21', title: 'bleibt' });
    if (!a.ok) throw new Error('create');
    await completeFollowUp(deps, ctx, { id: a.value.id });
    const before = actions(deps).length;

    const removed = deps.db.transaction((tx) => deleteFollowUpsFor(tx, 'document', 'D1'));

    expect(removed).toBe(2);
    expect(deps.db.select().from(followUps).all().map((f) => f.title)).toEqual(['bleibt']);
    expect(actions(deps).length).toBe(before);
  });
});

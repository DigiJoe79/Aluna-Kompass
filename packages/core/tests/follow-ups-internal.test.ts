import { describe, expect, it } from 'vitest';
import { auditLog, followUps } from '../src/db/schema';
import { completeFollowUpsInternal, createFollowUpInternal } from '../src/follow-ups/internal';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

function setup() {
  const deps = createTestDeps({ now: '2026-09-12T08:00:00.000Z' });
  const userId = insertUser(deps, { name: 'Anna' });
  return { deps, ctx: ctxWith([], userId), userId };
}
const input = (o: Record<string, unknown> = {}) => ({ entityType: 'thing', entityId: 'T1', dueAt: '2026-09-20', title: 'Prüfen', assigneeUserId: null, ...o });
const actions = (deps: ReturnType<typeof setup>['deps']) => deps.db.select().from(auditLog).all().map((e) => e.action);

describe('Wiedervorlage in der Transaktion des Aufrufers', () => {
  it('legt Zeile und Protokoll wie createFollowUp an, ohne Rechteprüfung', () => {
    const { deps, ctx, userId } = setup();
    const record = deps.db.transaction((tx) => createFollowUpInternal(tx, deps, ctx, input({ assigneeUserId: userId })));
    expect(record).toMatchObject({ entityType: 'thing', entityId: 'T1', dueAt: '2026-09-20', title: 'Prüfen', assigneeUserId: userId, doneAt: null, createdByUserId: userId });
    const entry = deps.db.select().from(auditLog).all().find((e) => e.action === 'followUps.create')!;
    expect(JSON.parse(entry.params!)).toEqual({ label: 'Prüfen', onRecord: false, dueOn: '2026-09-20' });
  });

  it('rollt mit der Transaktion zurück und wirft bei unbekanntem Nutzer', () => {
    const { deps, ctx } = setup();
    expect(() =>
      deps.db.transaction((tx) => {
        createFollowUpInternal(tx, deps, ctx, input());
        throw new Error('danach gescheitert');
      }),
    ).toThrow(/danach/);
    expect(deps.db.select().from(followUps).all()).toEqual([]);
    expect(() => deps.db.transaction((tx) => createFollowUpInternal(tx, deps, ctx, input({ assigneeUserId: 'NIEMAND' })))).toThrow(/unknown user/);
  });

  it('erledigt nur offene, passende Wiedervorlagen, je mit Protokoll', () => {
    const { deps, ctx } = setup();
    deps.db.transaction((tx) => {
      createFollowUpInternal(tx, deps, ctx, input({ title: 'Jahresrechnung abzeichnen' }));
      createFollowUpInternal(tx, deps, ctx, input({ title: 'Etwas anderes' }));
      createFollowUpInternal(tx, deps, ctx, input({ entityId: 'T2', title: 'Jahresrechnung abzeichnen' }));
    });
    expect(deps.db.transaction((tx) => completeFollowUpsInternal(tx, deps, ctx, { entityType: 'thing', entityId: 'T1', titlePrefix: 'Jahresrechnung' }))).toBe(1);
    expect(deps.db.transaction((tx) => completeFollowUpsInternal(tx, deps, ctx, { entityType: 'thing', entityId: 'T1' }))).toBe(1);
    expect(deps.db.transaction((tx) => completeFollowUpsInternal(tx, deps, ctx, { entityType: 'thing', entityId: 'T1' }))).toBe(0);
    const open = deps.db.select().from(followUps).all().filter((f) => f.doneAt === null);
    expect(open.map((f) => f.entityId)).toEqual(['T2']);
    expect(actions(deps).filter((a) => a === 'followUps.complete')).toHaveLength(2);
  });
});

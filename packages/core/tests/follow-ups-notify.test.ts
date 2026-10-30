import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { followUps } from '../src/db/schema';
import { createFollowUp } from '../src/follow-ups/service';
import { followUpMailState, followUpMailStateInternal, notifyFollowUpAssignee } from '../src/follow-ups/notify';
import { defineModule } from '../src/modules/manifest';
import { unwrap } from '../src/result';
import { writeSettingInternal } from '../src/settings/service';
import type { SystemMailMessage } from '../src/system-mail';
import { createTestDeps, ctxWith, insertUser, systemContext } from '../src/testing';

const ALL = ['followUps.view', 'followUps.manage', 'x.view'];

/**
 * Ein Modul mit Mailversand und Beschriftung: `OPEN` darf jeder lesen, `SECRET` nur mit `x.view`, `HEIKEL` ist heikel.
 * `fail` lässt den Versand scheitern, `available` schaltet ihn ab.
 */
function setup(opts: { publicUrl?: string | null; available?: boolean } = {}) {
  const sent: SystemMailMessage[] = [];
  const state = { fail: false };
  const mod = defineModule({
    key: 'x',
    version: '1',
    permissions: ['x.view'],
    systemMail: { available: () => opts.available ?? true, send: async (_d, m) => (state.fail ? { sent: false, reason: 'sendFailed' } : (sent.push(m), { sent: true })) },
    recordLabels: (_deps, ctx, entityType, id) => {
      if (entityType !== 'thing') return null;
      if (id === 'SECRET' && !ctx.permissions.has('x.view')) return { label: 'Ding (kein Zugriff)', href: '/things/SECRET', state: 'forbidden' };
      return { label: `Ding ${id}`, href: `/things/${id}`, state: 'ok', ...(id === 'HEIKEL' ? { sensitive: true } : {}) };
    },
  });
  const deps = createTestDeps({ manifests: [coreModule, mod], now: '2026-09-12T08:00:00.000Z' });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['x']));
  if (opts.publicUrl !== null) deps.publicUrl = opts.publicUrl ?? 'https://kompass.example.org';
  const anna = insertUser(deps, { name: 'Anna Anlegerin', email: 'anna@example.org' });
  const bert = insertUser(deps, { name: 'Bert Empfänger', email: 'bert@example.org' });
  return { deps, ctx: ctxWith(ALL, anna), anna, bert, sent, state };
}

const create = (s: ReturnType<typeof setup>, input: Record<string, unknown>) => createFollowUp(s.deps, s.ctx, { entityType: 'thing', entityId: 'OPEN', dueAt: '2026-09-20', title: 'Unterlagen prüfen', ...input });

describe('Mail an die zugewiesene Person einer Wiedervorlage', () => {
  it('schickt der anderen Person genau eine Mail mit Titel, Datum, Absender und Link', async () => {
    const s = setup();
    const created = unwrap(await create(s, { assigneeUserId: s.bert }));
    expect(created.notice).toEqual({ mail: 'sent' });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.to).toBe('bert@example.org');
    expect(s.sent[0]!.subject).toContain('Unterlagen prüfen');
    expect(s.sent[0]!.text).toContain('Anna Anlegerin');
    expect(s.sent[0]!.text).toContain('20.09.2026');
    expect(s.sent[0]!.text).toContain('https://kompass.example.org/things/OPEN');
  });

  it('nennt ohne Adresse der Installation den Weg in Kompass statt eines Links', async () => {
    const s = setup({ publicUrl: null });
    unwrap(await create(s, { assigneeUserId: s.bert }));
    expect(s.sent[0]!.text).not.toContain('/things/OPEN');
    expect(s.sent[0]!.text).toContain('Startseite');
  });

  it('schickt nichts an sich selbst und ohne Zuweisung', async () => {
    const s = setup();
    expect(unwrap(await create(s, { assigneeUserId: s.anna })).notice).toEqual({ mail: 'notNeeded' });
    expect(unwrap(await create(s, {})).notice).toEqual({ mail: 'notNeeded' });
    expect(s.sent).toEqual([]);
  });

  it('meldet eine ungültige Adresse und fehlenden Versand, die Wiedervorlage bleibt gespeichert', async () => {
    const s = setup();
    const broken = insertUser(s.deps, { name: 'Ohne', email: 'keine-adresse' });
    expect(unwrap(await create(s, { assigneeUserId: broken })).notice).toEqual({ mail: 'noAddress' });
    const off = setup({ available: false });
    expect(unwrap(await create(off, { assigneeUserId: off.bert })).notice).toEqual({ mail: 'unavailable' });
    expect(off.deps.db.select().from(followUps).all()).toHaveLength(1);
    expect(s.sent).toEqual([]);
  });

  it('meldet einen gescheiterten Versand, ohne zu werfen', async () => {
    const s = setup();
    s.state.fail = true;
    expect(unwrap(await create(s, { assigneeUserId: s.bert })).notice).toEqual({ mail: 'failed' });
  });

  it('nennt keinen Titel, wenn die Person den Datensatz nicht lesen darf oder er heikel ist', async () => {
    const s = setup();
    unwrap(await create(s, { entityId: 'SECRET', assigneeUserId: s.bert, title: 'Geheimer Titel' }));
    unwrap(await create(s, { entityId: 'HEIKEL', assigneeUserId: s.bert, title: 'Heikler Titel' }));
    expect(s.sent).toHaveLength(2);
    for (const m of s.sent) expect(`${m.subject}\n${m.text}`).not.toMatch(/Geheimer Titel|Heikler Titel/);
  });

  it('schreibt keinen eigenen Protokolleintrag', async () => {
    const s = setup();
    const record = unwrap(await create(s, {}));
    const count = () => s.deps.sqlite.prepare('SELECT count(*) AS n FROM audit_log').get();
    const before = count();
    expect(await notifyFollowUpAssignee(s.deps, s.ctx, { ...record, assigneeUserId: s.bert })).toEqual({ mail: 'sent' });
    expect(count()).toEqual(before);
  });
});

describe('Zustand der Mail vor dem Zuweisen', () => {
  it('sagt ohne zu senden, ob eine Mail ginge', async () => {
    const s = setup();
    const broken = insertUser(s.deps, { name: 'Ohne', email: 'keine-adresse' });
    expect(followUpMailStateInternal(s.deps, s.bert, s.anna)).toBe('ready');
    expect(followUpMailStateInternal(s.deps, s.anna, s.anna)).toBe('notNeeded');
    expect(followUpMailStateInternal(s.deps, broken, s.anna)).toBe('noAddress');
    const off = setup({ available: false });
    expect(followUpMailStateInternal(off.deps, off.bert, off.anna)).toBe('unavailable');
    expect(unwrap(await followUpMailState(s.deps, s.ctx, { assigneeUserId: s.bert }))).toEqual({ state: 'ready' });
    expect(s.sent).toEqual([]);
  });

  it('verlangt followUps.view und eine bekannte Person', async () => {
    const s = setup();
    const denied = await followUpMailState(s.deps, ctxWith([], s.anna), { assigneeUserId: s.bert });
    expect(denied.ok ? null : denied.error.type).toBe('forbidden');
    const missing = await followUpMailState(s.deps, s.ctx, { assigneeUserId: 'NIEMAND' });
    expect(missing.ok ? null : missing.error.type).toBe('notFound');
    const invalid = await followUpMailState(s.deps, s.ctx, {});
    expect(invalid.ok ? null : invalid.error.type).toBe('validation');
  });
});

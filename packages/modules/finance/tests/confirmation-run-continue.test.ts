import { schema, unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact, updateContact } from '@kompass/module-contacts';
import { eq, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { issueConfirmation } from '../src/donations/confirmations';
import { supersedeNotice } from '../src/donations/notices';
import { continueConfirmationRun, dispatchRunConfirmations, getConfirmationRun, listConfirmationRuns, previewConfirmationRun, startConfirmationRun } from '../src/donations/runs';
import { financeConfirmationRunItems, financeConfirmationRuns, financeConfirmations } from '../src/schema';
import { allowHumanOnlyOverMcp } from './helpers';
import { donationFixture, err, type DonationFixture } from './donation-fixture';

/**
 * Serienlauf, Lauf (F6b Task 3): starten mit Schnappschuss, fortsetzen in
 * Häppchen unter dem Aufrufer über `issueConfirmation`, lesen, Nachzügler,
 * Versandvermerk für alle. Heute ist der 2026-03-20.
 */
const setSetting = (f: DonationFixture, key: string, value: unknown) =>
  f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), key, value, 'test.confirmationRuns'));

const person = async (f: DonationFixture, firstName: string, lastName: string, address = true) =>
  unwrap(await createContact(f.deps, f.manage, { kind: 'person', firstName, lastName, ...(address ? { street: 'Probeweg 3', postalCode: '11111', city: 'Probestadt' } : {}) }));

/** Drei Spender mit je einer Geldzuwendung — Anna, Bert, Erika (Reihenfolge nach Namen). */
async function threeDonors(f: DonationFixture) {
  const anna = await person(f, 'Anna', 'Alpha');
  const bert = await person(f, 'Bert', 'Beta');
  await f.donate({ date: '2026-01-10', cents: 3000, contactId: anna.id });
  await f.donate({ date: '2026-01-11', cents: 2000, contactId: bert.id });
  await f.donate({ date: '2026-01-12', cents: 1000 });
  return { anna, bert };
}

const runAudit = (f: DonationFixture) => f.deps.db.select().from(schema.auditLog).where(like(schema.auditLog.entityType, 'financeConfirmationRun%')).all();

describe('startConfirmationRun', () => {
  it('starts a run with a snapshot of the preview items and refuses an empty one', async () => {
    const f = await donationFixture({ machine: true });
    const { anna, bert } = await threeDonors(f);
    const nora = await person(f, 'Nora', 'Ohneort', false);
    await f.donate({ date: '2026-01-13', cents: 900, contactId: nora.id });

    const preview = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026, excludedContactIds: [bert.id] }));
    const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026, excludedContactIds: [bert.id] }));
    expect(run).toMatchObject({ year: 2026, minCents: 0, excludedCount: 1, followUpOfRunId: null, startedOn: '2026-03-20', startedAt: '2026-03-20T10:00:00.000Z', finishedAt: null, dispatchedAt: null, dispatchedVia: null });
    expect(run.counts).toEqual({ total: 3, pending: 2, issued: 0, failed: 0, skipped: 1, machine: 0, needsSignature: 0, missingSignedVersion: 0 });
    expect(run.items.map((i) => [i.contactName, i.kind, i.lineIds, i.totalCents, i.needsSignature, i.state, i.errorCode])).toEqual(
      preview.items.map((p) => [p.contactName, p.kind, p.lineIds, p.totalCents, false, p.group === 'addressMissing' ? 'skipped' : 'pending', p.group === 'addressMissing' ? 'confirmationContactIncomplete' : null]),
    );
    expect(run.items.map((i) => i.contactId)).toEqual([anna.id, f.erika.id, nora.id]);
    // Der Schnappschuss steht in der Datenbank, mit dem Sortierschlüssel in Kleinbuchstaben.
    const rows = f.deps.db.select().from(financeConfirmationRunItems).where(eq(financeConfirmationRunItems.runId, run.id)).all();
    expect(rows.map((r) => r.sortKey).sort()).toEqual(['anna alpha', 'erika beispiel', 'nora ohneort']);
    expect(JSON.parse(f.deps.db.select().from(financeConfirmationRuns).where(eq(financeConfirmationRuns.id, run.id)).get()!.excludedContactIds)).toEqual([bert.id]);

    // Nichts zu tun: alles ausgeschlossen, oder nur Posten, die übersprungen würden.
    expect(err(await startConfirmationRun(f.deps, f.ctx, { year: 2025 }))).toMatchObject({ type: 'conflict', code: 'runNothingToIssue' });
    expect(err(await startConfirmationRun(f.deps, f.ctx, { year: 2026, excludedContactIds: [anna.id, bert.id, f.erika.id] }))).toMatchObject({ type: 'conflict', code: 'runNothingToIssue' });
  });

  it('refuses to start a blocked run, naming the reason', async () => {
    const f = await donationFixture({ notice: false });
    await f.donate();
    expect(err(await startConfirmationRun(f.deps, f.ctx, { year: 2026 }))).toMatchObject({ type: 'conflict', code: 'runBlocked' });
    expect(f.deps.db.select().from(financeConfirmationRuns).all()).toHaveLength(0);
  });

  it('snapshots the items at start, not at preview', async () => {
    const f = await donationFixture({ machine: true });
    const nora = await person(f, 'Nora', 'Ohneort', false);
    await f.donate({ date: '2026-01-13', cents: 900, contactId: nora.id });
    await f.donate({ date: '2026-01-12', cents: 1000 });
    expect(unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026 })).counts).toEqual({ ready: 1, needsSignature: 0, addressMissing: 1, blocked: 0 });

    // Zwischen Vorschau und Start bekommt Nora eine Anschrift — der Lauf rechnet beim Start neu.
    unwrap(await updateContact(f.deps, f.manage, { id: nora.id, street: 'Neuweg 1', postalCode: '22222', city: 'Neustadt' }));
    const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026 }));
    expect(run.counts).toMatchObject({ total: 2, pending: 2, skipped: 0 });

    // Nach dem Start bleibt der Schnappschuss: eine neue Zuwendung kommt nicht mehr hinein.
    await f.donate({ date: '2026-02-01', cents: 5000 });
    const read = unwrap(await getConfirmationRun(f.deps, f.ctx, { id: run.id }));
    expect(read.items.find((i) => i.contactId === f.erika.id)!.totalCents).toBe(1000);
    expect(read.counts.total).toBe(2);
  });

  it('skips donations before the start of the exemption, and a follow-up run still knows them as missing', async () => {
    const f = await donationFixture();
    const early = await f.donate({ date: '2025-03-01', cents: 1000 });
    const max = await person(f, 'Max', 'Probe');
    await f.donate({ date: '2025-06-01', cents: 2000, contactId: max.id });

    const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2025 }));
    expect(run.items.map((i) => [i.contactName, i.state, i.errorCode, i.needsSignature])).toEqual([
      ['Erika Beispiel', 'skipped', 'confirmationBeforeExemptionStart', false],
      ['Max Probe', 'pending', null, true],
    ]);
    const done = unwrap(await continueConfirmationRun(f.deps, f.ctx, { runId: run.id }));
    expect(done.items.map((i) => i.state)).toEqual(['skipped', 'issued']);

    // Der Nachzügler-Lauf zeigt die frühe Zuwendung weiter — gesperrt, nie bestätigt.
    const followUp = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2025, followUpOfRunId: run.id }));
    expect(followUp.items).toEqual([expect.objectContaining({ contactId: f.erika.id, lineIds: [early.line.id], group: 'blocked', blockedBy: 'afterExemptionStart' })]);
    expect(f.deps.db.select().from(financeConfirmations).all()).toHaveLength(1);
  });
});

describe('continueConfirmationRun', () => {
  it('continues at most max items per call under the caller and finishes when nothing is pending', async () => {
    const f = await donationFixture({ machine: true });
    await threeDonors(f);
    const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026 }));

    const first = unwrap(await continueConfirmationRun(f.deps, f.ctx, { runId: run.id, max: 2 }));
    expect(first.counts).toMatchObject({ total: 3, pending: 1, issued: 2, failed: 0, machine: 2, needsSignature: 0 });
    expect(first.finishedAt).toBeNull();
    // In der Reihenfolge der Namen, als Sammelbestätigung, unter dem Aufrufer.
    expect(first.items.map((i) => [i.contactName, i.state])).toEqual([['Anna Alpha', 'issued'], ['Bert Beta', 'issued'], ['Erika Beispiel', 'pending']]);
    const issued = f.deps.db.select().from(financeConfirmations).all();
    expect(issued.map((c) => [c.kind, c.issuedOn, c.issuedByUserId, c.issuedChannel, c.machine])).toEqual([
      ['collective', '2026-03-20', f.userId, 'ui', true],
      ['collective', '2026-03-20', f.userId, 'ui', true],
    ]);
    expect(first.items[0]!.confirmationNumber).toBe(issued.find((c) => c.id === first.items[0]!.confirmationId)!.documentNumber);

    // Am nächsten Tag geht es weiter — ausgestellt wird am Tag des Starts.
    f.deps.clock.set('2026-03-21T08:00:00.000Z');
    const second = unwrap(await continueConfirmationRun(f.deps, f.ctx, { runId: run.id }));
    expect(second.counts).toMatchObject({ pending: 0, issued: 3 });
    expect(second.finishedAt).toBe('2026-03-21T08:00:00.000Z');
    expect(f.deps.db.select().from(financeConfirmations).all().map((c) => c.issuedOn)).toEqual(['2026-03-20', '2026-03-20', '2026-03-20']);
    expect(err(await continueConfirmationRun(f.deps, f.ctx, { runId: run.id }))).toMatchObject({ type: 'conflict', code: 'runAlreadyFinished' });
  });

  it('records the failure code on an item and goes on', async () => {
    const f = await donationFixture({ machine: true });
    await f.donate({ date: '2026-01-12', cents: 1000 });
    await f.waive({ date: '2026-01-20', cents: 4200 });
    const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026 }));
    expect(run.items.map((i) => [i.kind, i.needsSignature])).toEqual([['collective', false], ['collectiveWaiver', true]]);

    // Der Verein bestätigt Aufwandsspenden ab jetzt nicht mehr — der zweite Posten scheitert, der Lauf endet trotzdem.
    setSetting(f, 'finance.expenseWaiversEnabled', false);
    const done = unwrap(await continueConfirmationRun(f.deps, f.ctx, { runId: run.id }));
    expect(done.items.map((i) => [i.kind, i.state, i.errorCode])).toEqual([['collective', 'issued', null], ['collectiveWaiver', 'failed', 'confirmationExpenseWaiversDisabled']]);
    expect(done.counts).toMatchObject({ pending: 0, issued: 1, failed: 1 });
    expect(done.finishedAt).not.toBeNull();
  });

  it('keeps issued confirmations and records the failure code on later items when the notice changes mid-run', async () => {
    const f = await donationFixture({ machine: true });
    await threeDonors(f);
    const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026 }));
    const first = unwrap(await continueConfirmationRun(f.deps, f.ctx, { runId: run.id, max: 1 }));
    const kept = first.items[0]!.confirmationId!;

    unwrap(await supersedeNotice(f.deps, f.ctx, { id: f.notice!.id, supersededOn: '2026-03-01' }));
    const done = unwrap(await continueConfirmationRun(f.deps, f.ctx, { runId: run.id }));
    expect(done.items.map((i) => [i.contactName, i.state, i.errorCode])).toEqual([
      ['Anna Alpha', 'issued', null],
      ['Bert Beta', 'failed', 'noNoticeValidAt'],
      ['Erika Beispiel', 'failed', 'noNoticeValidAt'],
    ]);
    expect(done.items[0]!.confirmationId).toBe(kept);
    expect(f.deps.db.select().from(financeConfirmations).where(eq(financeConfirmations.id, kept)).get()!.voidedAt).toBeNull();
    expect(done.counts).toMatchObject({ pending: 0, issued: 1, failed: 2 });
    expect(done.finishedAt).not.toBeNull();
  });

  it('never issues an item twice under two concurrent continues', async () => {
    const f = await donationFixture({ machine: true });
    await threeDonors(f);
    const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026 }));

    // Zwei Browser: beide greifen dieselben offenen Posten, bevor einer von ihnen fertig ist.
    const results = await Promise.all([continueConfirmationRun(f.deps, f.ctx, { runId: run.id }), continueConfirmationRun(f.deps, f.ctx, { runId: run.id })]);
    expect(results.every((r) => r.ok)).toBe(true);
    const confirmations = f.deps.db.select().from(financeConfirmations).all();
    expect(confirmations).toHaveLength(3);
    const view = unwrap(await getConfirmationRun(f.deps, f.ctx, { id: run.id }));
    expect(view.counts).toMatchObject({ pending: 0, issued: 3, failed: 0 });
    // Der Verlierer trägt die Bestätigung des Gewinners nach.
    expect(new Set(view.items.map((i) => i.confirmationId))).toEqual(new Set(confirmations.map((c) => c.id)));
    expect(view.finishedAt).not.toBeNull();

    // Kommt der Verlierer zuerst zum Festhalten, trägt er die Bestätigung des anderen nach, statt zu scheitern.
    const g = await donationFixture({ machine: true });
    const { line } = await g.donate({ date: '2026-01-12', cents: 1000 });
    const other = unwrap(await startConfirmationRun(g.deps, g.ctx, { year: 2026 }));
    const winner = unwrap(await issueConfirmation(g.deps, g.ctx, { lineIds: [line.id], kind: 'collective' }));
    const late = unwrap(await continueConfirmationRun(g.deps, g.ctx, { runId: other.id }));
    expect(late.items.map((i) => [i.state, i.confirmationId, i.errorCode])).toEqual([['issued', winner.id, null]]);
    expect(g.deps.db.select().from(financeConfirmations).all()).toHaveLength(1);
  });

  it('a follow-up run only contains what is still missing', async () => {
    const f = await donationFixture({ machine: true });
    const nora = await person(f, 'Nora', 'Ohneort', false);
    await f.donate({ date: '2026-01-13', cents: 900, contactId: nora.id });
    await f.donate({ date: '2026-01-12', cents: 1000 });
    const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026 }));
    unwrap(await continueConfirmationRun(f.deps, f.ctx, { runId: run.id }));

    unwrap(await updateContact(f.deps, f.manage, { id: nora.id, street: 'Neuweg 1', postalCode: '22222', city: 'Neustadt' }));
    const preview = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026, followUpOfRunId: run.id }));
    expect(preview.items.map((i) => i.contactId)).toEqual([nora.id]);
    const followUp = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026, followUpOfRunId: run.id }));
    expect(followUp.followUpOfRunId).toBe(run.id);
    expect(followUp.items.map((i) => [i.contactId, i.state])).toEqual([[nora.id, 'pending']]);
    expect(err(await startConfirmationRun(f.deps, f.ctx, { year: 2026, followUpOfRunId: 'fehlt' }))).toMatchObject({ type: 'notFound' });
  });

  it('a follow-up run inherits the exclusions of its origin', async () => {
    const f = await donationFixture({ machine: true });
    const { bert } = await threeDonors(f);
    const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026, excludedContactIds: [bert.id] }));
    unwrap(await continueConfirmationRun(f.deps, f.ctx, { runId: run.id }));
    // Anna und Erika sind schon bestätigt — offen wäre nur Bert, aber der Ursprungslauf schloss ihn aus.
    expect(run.excludedContactIds).toEqual([bert.id]);

    // Ohne eigene Ausschlüsse übernimmt die Vorschau die des Ursprungslaufs, ohne dass jemand sie erneut nennt.
    const inherited = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026, followUpOfRunId: run.id }));
    expect(inherited.excludedContactIds).toEqual([bert.id]);
    expect(inherited.items).toEqual([]);

    // Ein ausdrücklich leeres Feld ist eine eigene Angabe — sie überschreibt die des Ursprungslaufs, statt sie zu ergänzen.
    const own = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026, followUpOfRunId: run.id, excludedContactIds: [] }));
    expect(own.excludedContactIds).toEqual([]);
    expect(own.items.map((i) => i.contactId)).toEqual([bert.id]);
  });
});

describe('dispatchRunConfirmations', () => {
  it('dispatches all machine items once, skips signature items and already dispatched ones', async () => {
    const f = await donationFixture({ machine: true });
    const { anna } = await threeDonors(f);
    await f.waive({ date: '2026-01-20', cents: 4200 });
    const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026 }));
    const issued = unwrap(await continueConfirmationRun(f.deps, f.ctx, { runId: run.id }));
    expect(issued.counts).toMatchObject({ issued: 4, machine: 3, needsSignature: 1, missingSignedVersion: 1 });

    // Annas Bestätigung ist schon einzeln vermerkt.
    const annaConfirmation = issued.items.find((i) => i.contactId === anna.id)!.confirmationId!;
    f.deps.db.update(financeConfirmations).set({ sentAt: '2026-03-20', sentVia: 'handed' }).where(eq(financeConfirmations.id, annaConfirmation)).run();

    const dispatched = unwrap(await dispatchRunConfirmations(f.deps, f.ctx, { runId: run.id, sentAt: '2026-03-22', sentVia: 'post' }));
    expect(dispatched).toMatchObject({ dispatchedAt: '2026-03-22', dispatchedVia: 'post' });
    const rows = f.deps.db.select().from(financeConfirmations).all();
    expect(rows.filter((c) => c.machine).map((c) => [c.id === annaConfirmation, c.sentAt, c.sentVia]).sort()).toEqual([
      [false, '2026-03-22', 'post'],
      [false, '2026-03-22', 'post'],
      [true, '2026-03-20', 'handed'],
    ]);
    expect(rows.filter((c) => !c.machine).map((c) => c.sentAt)).toEqual([null]);
    const perConfirmation = f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'finance.confirmation.dispatch')).all();
    expect(perConfirmation).toHaveLength(2);

    expect(err(await dispatchRunConfirmations(f.deps, f.ctx, { runId: run.id, sentAt: '2026-03-23', sentVia: 'email' }))).toMatchObject({ type: 'conflict', code: 'dispatchNothingMachine' });
  });
});

describe('access, validation, audit', () => {
  it('human only over mcp for start and continue; the agent may read and preview', async () => {
    const f = await donationFixture({ machine: true });
    await f.donate({ date: '2026-01-12', cents: 1000 });
    const agent = { ...f.ctx, channel: 'mcp' as const };
    expect(err(await startConfirmationRun(f.deps, agent, { year: 2026 }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    unwrap(await previewConfirmationRun(f.deps, agent, { year: 2026 }));
    const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026 }));
    expect(err(await continueConfirmationRun(f.deps, agent, { runId: run.id }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    expect(unwrap(await getConfirmationRun(f.deps, agent, { id: run.id })).id).toBe(run.id);
    expect(unwrap(await listConfirmationRuns(f.deps, agent, {})).items.map((r) => r.id)).toEqual([run.id]);

    allowHumanOnlyOverMcp(f.deps);
    const done = unwrap(await continueConfirmationRun(f.deps, agent, { runId: run.id }));
    expect(f.deps.db.select().from(financeConfirmations).where(eq(financeConfirmations.id, done.items[0]!.confirmationId!)).get()!.issuedChannel).toBe('mcp');
    // Der Versandvermerk ist kein humanOnly-Dienst.
    unwrap(await dispatchRunConfirmations(f.deps, agent, { runId: run.id, sentAt: '2026-03-20', sentVia: 'email' }));
  });

  it('forbidden/validation/audit without contact ids', async () => {
    const f = await donationFixture({ machine: true });
    const { anna, bert } = await threeDonors(f);
    const reader = ctxWith(['finance.read'], f.userId);
    const overview = ctxWith(['finance.overview'], f.userId);

    expect(err(await startConfirmationRun(f.deps, reader, { year: 2026 }))).toEqual({ type: 'forbidden', permission: 'finance.donationsIssue' });
    for (const input of [{}, { year: '2026' }, { year: 2026, minCents: -1 }, { year: 2027 }]) {
      expect(err(await startConfirmationRun(f.deps, f.ctx, input)), JSON.stringify(input)).toMatchObject({ type: 'validation' });
    }

    const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026, excludedContactIds: [bert.id] }));
    expect(err(await continueConfirmationRun(f.deps, reader, { runId: run.id }))).toEqual({ type: 'forbidden', permission: 'finance.donationsIssue' });
    for (const input of [{}, { runId: '' }, { runId: run.id, max: 0 }, { runId: run.id, max: 51 }, { runId: run.id, max: 1.5 }]) {
      expect(err(await continueConfirmationRun(f.deps, f.ctx, input)), JSON.stringify(input)).toMatchObject({ type: 'validation' });
    }
    expect(err(await continueConfirmationRun(f.deps, f.ctx, { runId: 'fehlt' }))).toMatchObject({ type: 'notFound' });
    expect(err(await getConfirmationRun(f.deps, overview, { id: run.id }))).toEqual({ type: 'forbidden', permission: 'finance.read' });
    expect(err(await getConfirmationRun(f.deps, f.ctx, { id: 'fehlt' }))).toMatchObject({ type: 'notFound' });
    expect(err(await listConfirmationRuns(f.deps, overview, {}))).toEqual({ type: 'forbidden', permission: 'finance.read' });
    expect(err(await listConfirmationRuns(f.deps, f.ctx, { limit: 0 }))).toMatchObject({ type: 'validation' });

    unwrap(await continueConfirmationRun(f.deps, f.ctx, { runId: run.id }));
    expect(err(await dispatchRunConfirmations(f.deps, reader, { runId: run.id, sentAt: '2026-03-22', sentVia: 'post' }))).toEqual({ type: 'forbidden', permission: 'finance.donationsIssue' });
    expect(err(await dispatchRunConfirmations(f.deps, f.ctx, { runId: run.id, sentAt: 'morgen', sentVia: 'post' }))).toMatchObject({ type: 'validation' });
    expect(err(await dispatchRunConfirmations(f.deps, f.ctx, { runId: run.id, sentAt: '2026-03-22', sentVia: 'fax' }))).toMatchObject({ type: 'validation' });
    unwrap(await dispatchRunConfirmations(f.deps, f.ctx, { runId: run.id, sentAt: '2026-03-22', sentVia: 'post' }));

    const entries = runAudit(f);
    const byAction = (action: string) => entries.filter((e) => e.action === action).map((e) => JSON.parse(e.after as string));
    expect(byAction('finance.confirmationRun.start')).toEqual([{ year: 2026, minCents: 0, excludedCount: 1, followUpOfRunId: null, startedOn: '2026-03-20', itemCount: 2, channel: 'ui' }]);
    const items = byAction('finance.confirmationRun.item');
    expect(items).toHaveLength(2);
    for (const item of items) expect(Object.keys(item).sort()).toEqual(['confirmationId', 'errorCode', 'kind', 'lineCount', 'runId', 'state', 'totalCents']);
    expect(items.map((i) => [i.runId, i.kind, i.state, i.errorCode])).toEqual([[run.id, 'collective', 'issued', null], [run.id, 'collective', 'issued', null]]);
    expect(byAction('finance.confirmationRun.finish')).toEqual([{ itemCount: 2, issuedCount: 2, failedCount: 0, finished: true }]);
    expect(byAction('finance.confirmationRun.dispatch')).toEqual([{ dispatchedVia: 'post' }]);
    // Nie Kontakt-IDs, nie Namen, nie der Sortierschlüssel.
    const all = JSON.stringify(entries);
    for (const needle of [anna.id, bert.id, f.erika.id, 'Anna', 'Erika', 'erika beispiel']) expect(all).not.toContain(needle);
  });
});

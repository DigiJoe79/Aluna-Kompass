import { fixedClock, newId, schema, unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { deleteDraft, documentLinks, documents, fileDocument } from '@kompass/module-dms';
import { and, eq, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { prepareMandate } from '../src/direct-debit/mandates';
import { savePledge } from '../src/direct-debit/pledges';
import { issuePrenotification, prenotificationCovers } from '../src/direct-debit/prenotifications';
import { prenotificationPlanBody } from '../src/direct-debit/templates/prenotification';
import { installFinance } from '../src/install';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeSepaPrenotifications } from '../src/schema';
import { insertDocument, setupFinance } from './helpers';

// TEST_NOW: 2026-09-05 — Plan L2 Task 1, Spec § 7.5.
const IBAN = 'DE44999999990532013000';
const DMS = ['dms.view', 'dms.create', 'dms.file', 'dms.deleteDraft'];
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);

async function setup() {
  const f = setupFinance([...FINANCE_PERMISSIONS, ...DMS]);
  const write = (key: string, value: unknown) => f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), key, value));
  f.deps.db.transaction((tx) => installFinance(tx, f.deps, systemContext()));
  write('organization.name', 'Musterverein e.V.');
  write('finance.sepa.creditorId', 'DE98ZZZ09999999999');
  const contactCtx: CallContext = { ...f.ctx, permissions: new Set(['contacts.manage']) };
  const payer = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', salutation: 'Frau', firstName: 'Erika', lastName: 'Beispiel' }));
  const mandate = unwrap(await prepareMandate(f.deps, f.ctx, { contactId: payer.id, debtorName: 'Erika Beispiel', iban: IBAN }));
  return { ...f, write, payer, mandate };
}

describe('prenotificationCovers', () => {
  async function covered(opts: { voided?: boolean } = {}) {
    const f = await setup();
    const documentId = insertDocument(f, { subject: 'Ankündigung', typeKey: 'sepa-prenotification', voided: opts.voided });
    f.deps.db.update(documents).set({ documentDate: '2026-09-01' }).where(eq(documents.id, documentId)).run();
    f.deps.db
      .insert(financeSepaPrenotifications)
      .values({ id: newId(), mandateId: f.mandate.id, documentId, plan: [{ dueOn: '2026-10-01', amountCents: 1500 }, { dueOn: '2026-11-02', amountCents: 1500 }], createdByUserId: f.userId, createdAt: '2026-09-01T10:00:00.000Z' })
      .run();
    return f;
  }

  it('covers a collection on the announced day with the announced amount, issued at least the notice period before (E1)', async () => {
    const f = await covered();
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2026-10-01', 14)).toBe(true);
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2026-11-02', 14)).toBe(true);
    expect(prenotificationCovers(f.deps, f.mandate.id, 1600, '2026-10-01', 14)).toBe(false);
    // Ein Tag nach dem angekündigten Bankarbeitstag ist nicht gedeckt, ein Tag davor ebenso nicht.
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2026-10-02', 14)).toBe(false);
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2026-09-30', 14)).toBe(false);
    expect(prenotificationCovers(f.deps, 'OTHER', 1500, '2026-10-01', 14)).toBe(false);
  });

  it('an announced day that has passed does not cover a later collection (Review Focus 1, M6 Nachtrag)', async () => {
    const f = await covered();
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2026-11-16', 14)).toBe(false);
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2027-01-04', 14)).toBe(false);
  });

  it('issued too late for the collection day covers nothing', async () => {
    const f = await setup();
    const documentId = insertDocument(f, { subject: 'Ankündigung', typeKey: 'sepa-prenotification' });
    f.deps.db.update(documents).set({ documentDate: '2026-09-25' }).where(eq(documents.id, documentId)).run();
    f.deps.db.insert(financeSepaPrenotifications).values({ id: newId(), mandateId: f.mandate.id, documentId, plan: [{ dueOn: '2026-10-01', amountCents: 1500 }], createdByUserId: f.userId, createdAt: '2026-09-25T10:00:00.000Z' }).run();
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2026-10-01', 14)).toBe(false);
  });

  it('a day on a weekend or holiday covers the next bank business day, not later', async () => {
    const f = await setup();
    const documentId = insertDocument(f, { subject: 'Ankündigung', typeKey: 'sepa-prenotification' });
    f.deps.db.update(documents).set({ documentDate: '2026-09-01' }).where(eq(documents.id, documentId)).run();
    // Samstag 24.10.2026, Freitag 01.01.2027 (Feiertag) — ältere Zeilen nennen solche Tage noch.
    f.deps.db.insert(financeSepaPrenotifications).values({ id: newId(), mandateId: f.mandate.id, documentId, plan: [{ dueOn: '2026-10-24', amountCents: 1500 }, { dueOn: '2027-01-01', amountCents: 1200 }], createdByUserId: f.userId, createdAt: '2026-09-01T10:00:00.000Z' }).run();
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2026-10-26', 14)).toBe(true);
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2026-10-27', 14)).toBe(false);
    expect(prenotificationCovers(f.deps, f.mandate.id, 1200, '2027-01-04', 14)).toBe(true);
    expect(prenotificationCovers(f.deps, f.mandate.id, 1200, '2027-01-05', 14)).toBe(false);
  });

  it('a voided letter announces nothing', async () => {
    const f = await covered({ voided: true });
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2026-10-01', 14)).toBe(false);
  });
});

describe('issuePrenotification', () => {
  it('issues the letter into the file, linked to mandate and payer, and records which collections it covers', async () => {
    const f = await setup();
    const plan = [{ dueOn: '2026-10-01', amountCents: 1500 }, { dueOn: '2026-11-02', amountCents: 1500 }];
    const res = unwrap(await issuePrenotification(f.deps, f.ctx, { mandateId: f.mandate.id, plan }));
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, res.documentId)).get()!;
    expect(doc).toMatchObject({ typeKey: 'sepa-prenotification', phase: 'issued', subject: 'Lastschriftankündigung zum Mandat MND-000001' });
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, doc.id), eq(documentLinks.entityType, 'financeMandate'), eq(documentLinks.entityId, f.mandate.id))).all()).toHaveLength(1);
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, doc.id), eq(documentLinks.entityType, 'contact'), eq(documentLinks.entityId, f.payer.id))).all()).toHaveLength(1);
    expect(f.deps.db.select().from(financeSepaPrenotifications).all()).toMatchObject([{ mandateId: f.mandate.id, documentId: doc.id, plan }]);
    expect(doc.documentDate).toBe('2026-09-05');
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2026-10-01', 14)).toBe(true);
    const audit = f.deps.db.select().from(schema.auditLog).where(like(schema.auditLog.action, 'finance.prenotification.%')).all();
    expect(audit.map((a) => [a.action, a.params])).toEqual([['finance.prenotification.issue', JSON.stringify({ reference: 'MND-000001', count: 2 })]]);
  });

  it('names per row the day of the debit as „Einzug am“ and, when given, what for (R11); the remittance is kept in the plan', async () => {
    const plan = [{ dueOn: '2026-10-01', amountCents: 1200, remittance: 'Beitrag 2026 Mitglied 0002' }, { dueOn: '2026-10-01', amountCents: 1200 }];
    const body = prenotificationPlanBody({ greeting: 'Guten Tag,', creditorName: 'Musterverein e.V.', plan, iban: IBAN, reference: 'MND-000001', creditorId: 'DE98ZZZ09999999999' });
    expect(body).toContain('| Einzug am | Verwendungszweck | Betrag |');
    expect(body).toContain('| 01.10.2026 | Beitrag 2026 Mitglied 0002 | 12,00\u00a0€ |');
    expect(body).not.toContain('Fällig am');
    const f = await setup();
    const res = unwrap(await issuePrenotification(f.deps, f.ctx, { mandateId: f.mandate.id, plan: [{ dueOn: '2026-10-01', amountCents: 1200, remittance: 'Beitrag 2026 Mitglied 0002' }] }));
    expect(f.deps.db.select().from(financeSepaPrenotifications).where(eq(financeSepaPrenotifications.documentId, res.documentId)).get()!.plan).toEqual([{ dueOn: '2026-10-01', amountCents: 1200, remittance: 'Beitrag 2026 Mitglied 0002' }]);
  });

  it('names the day of the debit: a collection on that day is covered (E1 a)', async () => {
    const f = await setup();
    unwrap(await issuePrenotification(f.deps, f.ctx, { mandateId: f.mandate.id, plan: [{ dueOn: '2026-11-02', amountCents: 1500 }] }));
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2026-11-02', 14)).toBe(true);
  });

  it('refuses a day before today plus the notice period (E1 b, M6, M34)', async () => {
    const f = await setup();
    // Heute 05.09.2026, Frist 14 Tage: frühestens Samstag 19.09., als Bankarbeitstag Montag 21.09.
    expect(fail(await issuePrenotification(f.deps, f.ctx, { mandateId: f.mandate.id, plan: [{ dueOn: '2026-11-02', amountCents: 1500 }, { dueOn: '2026-09-15', amountCents: 1500 }] }))).toMatchObject({ type: 'conflict', code: 'prenotificationTooLate', params: { date: '2026-09-15', earliest: '2026-09-21' } });
    expect(f.deps.db.select().from(financeSepaPrenotifications).all()).toEqual([]);
    expect(f.deps.db.select().from(documents).where(eq(documents.typeKey, 'sepa-prenotification')).all()).toEqual([]);
  });

  it('a day on a weekend is issued as the next bank business day and covers that day (E1 d, M34)', async () => {
    const f = await setup();
    const res = unwrap(await issuePrenotification(f.deps, f.ctx, { mandateId: f.mandate.id, plan: [{ dueOn: '2026-10-24', amountCents: 1500 }] }));
    expect(f.deps.db.select().from(financeSepaPrenotifications).get()!.plan).toEqual([{ dueOn: '2026-10-26', amountCents: 1500 }]);
    expect(f.deps.db.select().from(documents).where(eq(documents.id, res.documentId)).get()!.inputSnapshot).toContain('26.10.2026');
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2026-10-26', 14)).toBe(true);
  });

  it('a notice for 01.11.2026 does not cover a collection on 04.01.2027 (E1 c)', async () => {
    const f = await setup();
    unwrap(await issuePrenotification(f.deps, f.ctx, { mandateId: f.mandate.id, plan: [{ dueOn: '2026-11-01', amountCents: 1500 }] }));
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2026-11-02', 14)).toBe(true);
    expect(prenotificationCovers(f.deps, f.mandate.id, 1500, '2027-01-04', 14)).toBe(false);
  });

  it('needs finance.directDebit and the rights of the file, a plan, and a mandate that is not ended', async () => {
    const f = await setup();
    const plan = [{ dueOn: '2026-10-01', amountCents: 1500 }];
    expect(fail(await issuePrenotification(f.deps, ctxWith(['finance.read', ...DMS], f.userId), { mandateId: f.mandate.id, plan }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await issuePrenotification(f.deps, ctxWith(FINANCE_PERMISSIONS, f.userId), { mandateId: f.mandate.id, plan }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await issuePrenotification(f.deps, f.ctx, { mandateId: f.mandate.id, plan: [] }))).toMatchObject({ type: 'validation' });
    expect(fail(await issuePrenotification(f.deps, f.ctx, { mandateId: f.mandate.id, plan: [{ dueOn: '2026-10-01', amountCents: 0 }] }))).toMatchObject({ type: 'validation' });
    expect(fail(await issuePrenotification(f.deps, f.ctx, { mandateId: 'NOPE', plan }))).toMatchObject({ type: 'notFound' });
    f.write('finance.sepa.creditorId', null);
    expect(fail(await issuePrenotification(f.deps, f.ctx, { mandateId: f.mandate.id, plan }))).toMatchObject({ code: 'sepaCreditorIdMissing' });
    expect(f.deps.db.select().from(financeSepaPrenotifications).all()).toEqual([]);
  });
});

describe('the prenotification draft of savePledge (L2 Nacharbeit 3)', () => {
  async function pledgeWithDraft() {
    const f = await setup();
    const res = unwrap(await savePledge(f.deps, f.ctx, { contactId: f.payer.id, amountCents: 1500, interval: 'monthly', firstDueOn: '2026-09-25', paymentMethod: 'directDebit', iban: IBAN, debtorName: 'Erika Beispiel' }));
    return { ...f, res, mandateId: res.pledge.mandate!.id };
  }

  it('records the first twelve months against the draft; a draft covers nothing', async () => {
    const f = await pledgeWithDraft();
    const rows = f.deps.db.select().from(financeSepaPrenotifications).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mandateId: f.mandateId, documentId: f.res.prenotificationDraftId });
    expect(rows[0]!.plan.map((e) => e.dueOn)).toEqual(['2026-09-25', '2026-10-25', '2026-11-25', '2026-12-25', '2027-01-25', '2027-02-25', '2027-03-25', '2027-04-25', '2027-05-25', '2027-06-25', '2027-07-25', '2027-08-25']);
    expect(rows[0]!.plan.every((e) => e.amountCents === 1500)).toBe(true);
    expect(prenotificationCovers(f.deps, f.mandateId, 1500, '2026-09-25', 14)).toBe(false);
  });

  it('filed 20 days before the collection it covers, by the date of the letter', async () => {
    const f = await pledgeWithDraft();
    unwrap(await fileDocument(f.deps, f.ctx, { id: f.res.prenotificationDraftId! }));
    expect(prenotificationCovers(f.deps, f.mandateId, 1500, '2026-09-25', 14)).toBe(true);
    expect(prenotificationCovers(f.deps, f.mandateId, 1500, '2026-09-18', 14)).toBe(false);
  });

  it('an old draft filed late counts from the day it was filed, not from its date', async () => {
    const f = await pledgeWithDraft();
    // Dokumentdatum 05.09.; festgeschrieben erst am 20.09. (Vereinstag) — für den Einzug am 25.09. zu spät.
    unwrap(await fileDocument({ ...f.deps, clock: fixedClock('2026-09-20T08:00:00.000Z') }, f.ctx, { id: f.res.prenotificationDraftId! }));
    expect(prenotificationCovers(f.deps, f.mandateId, 1500, '2026-09-25', 14)).toBe(false);
    expect(prenotificationCovers(f.deps, f.mandateId, 1500, '2026-10-25', 14)).toBe(true);
  });

  it('a deleted draft covers nothing', async () => {
    const f = await pledgeWithDraft();
    unwrap(await deleteDraft(f.deps, f.ctx, { id: f.res.prenotificationDraftId! }));
    expect(prenotificationCovers(f.deps, f.mandateId, 1500, '2026-09-25', 14)).toBe(false);
  });
});

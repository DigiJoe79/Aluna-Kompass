import { describe, expect, it } from 'vitest';
import { financePledgeRateMarks, financePledges, financeSepaCounter, financeSepaMandateChanges, financeSepaMandates } from '../src/schema';
import { setupFinance } from './helpers';

const NOW = '2026-09-05T10:00:00.000Z';

/** Plan L1 Task 2 — Mandate, ihr Änderungsverlauf, der Zähler der Referenzen, Zusagen und ausgelassene Raten. */
describe('direct debit schema', () => {
  it('stores a mandate with its change history and keeps the reference unique', () => {
    const { deps } = setupFinance();
    const mandate = (id: string, reference: string) =>
      deps.db.insert(financeSepaMandates).values({ id, contactId: 'C1', reference, debtorName: 'Erika Beispiel', iban: 'DE02999999990532013000', preparedOn: '2026-09-01', createdAt: NOW, updatedAt: NOW }).run();
    mandate('M1', 'MND-000001');
    expect(() => mandate('M2', 'MND-000001')).toThrow();
    const row = deps.db.select().from(financeSepaMandates).get()!;
    expect(row).toMatchObject({ sequence: 'recurring', bic: null, signedOn: null, signedDocumentId: null, endedOn: null, endReason: null, lastCollectedOn: null, pendingAmendment: null });
    deps.db.insert(financeSepaMandateChanges).values({ id: 'CH1', mandateId: 'M1', field: 'iban', before: 'DE02999999990532013000', after: 'DE23999999990000202051', validFrom: '2026-10-01', createdAt: NOW, createdByUserId: 'U1' }).run();
    expect(deps.db.select().from(financeSepaMandateChanges).all()).toHaveLength(1);
    deps.db.insert(financeSepaCounter).values({ id: 'mandate', last: 1 }).run();
    expect(deps.db.select().from(financeSepaCounter).get()).toEqual({ id: 'mandate', last: 1 });
  });

  it('stores a pledge and one skip mark per rate', () => {
    const { deps } = setupFinance();
    deps.db.insert(financePledges).values({ id: 'P1', contactId: 'C1', amountCents: 1000, interval: 'monthly', firstDueOn: '2026-01-15', paymentMethod: 'transfer', createdAt: NOW, updatedAt: NOW }).run();
    expect(deps.db.select().from(financePledges).get()).toMatchObject({ lastDueOn: null, mandateId: null, purposeId: null, projectId: null, pausedFrom: null, pausedUntil: null, endedOn: null, note: null });
    const mark = (id: string) => deps.db.insert(financePledgeRateMarks).values({ id, pledgeId: 'P1', dueOn: '2026-02-15', mark: 'skipped', reason: 'paused' }).run();
    mark('R1');
    expect(() => mark('R2')).toThrow();
  });
});

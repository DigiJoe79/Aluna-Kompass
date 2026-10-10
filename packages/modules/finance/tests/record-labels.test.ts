import { newId, resolveRecordLabel } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { saveDraft } from '../src/ledger/entries';
import { financeConfirmations, financePartnerProfiles, financePeriodEvents, financeReserves } from '../src/schema';
import { donationFixture } from './donation-fixture';

/**
 * Die Spalte „Objekt“ im Protokoll nennt Datensätze der Finanzen mit Namen (Joe 2026-10-09) — nur live und mit
 * Leserecht, nie im Protokoll gespeichert (Spec 10.3). `name` ist der bloße Name ohne Art; die Art nennt das Protokoll.
 */
describe('recordLabels der Finanzen', () => {
  it('nennt Konto, Zweck, Rücklage, Kategorie, Buchung, Bestätigung, Partner und Geschäftsjahr mit Namen', async () => {
    const f = await donationFixture();
    const { deps, ctx, userId } = f;
    const reader = ctxWith(['finance.read', 'contacts.view'], userId);
    const name = (type: string, id: string, c = reader) => {
      const label = resolveRecordLabel(deps, c, type, id);
      return label ? { state: label.state, name: label.name ?? label.label } : null;
    };
    const { entry } = await f.donate();
    const draft = await saveDraft(deps, ctx, { entryDate: '2026-03-02', text: 'Entwurf', moneyLines: [], allocationLines: [] });
    const reserveId = newId();
    deps.db.insert(financeReserves).values({ id: reserveId, kind: 'free', name: 'Freie Rücklage 2026', createdByUserId: userId, createdAt: 'now', updatedAt: 'now' }).run();
    const confirmationId = newId();
    deps.db.insert(financeConfirmations).values({ id: confirmationId, kind: 'money', contactId: f.erika.id, noticeId: f.notice!.id, documentId: 'DOC1', documentNumber: 'ZWB-2026-0007', issuedOn: '2026-03-05', issuedByUserId: userId, issuedChannel: 'ui', totalCents: 5000, createdAt: 'now' }).run();
    const partnerId = newId();
    deps.db.insert(financePartnerProfiles).values({ id: partnerId, contactId: f.erika.id, status: 'taxExemptBody', createdAt: 'now', createdByUserId: userId, updatedAt: 'now' }).run();
    const eventId = newId();
    deps.db.insert(financePeriodEvents).values({ id: eventId, fiscalYearId: f.years['2026']!.id, kind: 'closed', at: '2026-12-31T23:59:59.000Z', byUserId: userId }).run();

    expect(name('financeAccount', f.bank.id)).toEqual({ state: 'ok', name: 'Vereinskonto' });
    expect(name('financePurpose', f.abroadPurpose.id)).toEqual({ state: 'ok', name: 'Partnerprojekt Ausland' });
    expect(name('financeReserve', reserveId)).toEqual({ state: 'ok', name: 'Freie Rücklage 2026' });
    expect(name('financeCategory', f.donations.id)).toEqual({ state: 'ok', name: f.donations.name });
    expect(name('financeEntry', entry.id)).toEqual({ state: 'ok', name: entry.number });
    // Ein Entwurf hat keine Nummer: nur das Wort.
    expect(name('financeEntry', draft.ok ? draft.value.id : 'X')).toEqual({ state: 'ok', name: '' });
    expect(name('financeConfirmation', confirmationId)).toEqual({ state: 'ok', name: 'ZWB-2026-0007' });
    expect(name('financePartnerProfile', partnerId)).toEqual({ state: 'ok', name: 'Erika Beispiel' });
    expect(name('financePeriodEvent', eventId)).toEqual({ state: 'ok', name: '2026' });
    expect(name('financeFiscalYear', f.years['2026']!.id)).toEqual({ state: 'ok', name: '2026' });
  });

  it('ohne Leserecht kein Name, den Partner nur mit Leserecht für Kontakte, Gelöschtes als missing', async () => {
    const f = await donationFixture();
    const { deps, userId } = f;
    const partnerId = newId();
    deps.db.insert(financePartnerProfiles).values({ id: partnerId, contactId: f.erika.id, status: 'taxExemptBody', createdAt: 'now', createdByUserId: userId, updatedAt: 'now' }).run();
    expect(resolveRecordLabel(deps, ctxWith([], userId), 'financeAccount', f.bank.id)?.state).toBe('forbidden');
    expect(resolveRecordLabel(deps, ctxWith(['finance.read'], userId), 'financePartnerProfile', partnerId)?.state).toBe('forbidden');
    expect(resolveRecordLabel(deps, ctxWith(['finance.read'], userId), 'financePurpose', 'WEG')).toEqual({ label: '', href: null, state: 'missing' });
  });
});

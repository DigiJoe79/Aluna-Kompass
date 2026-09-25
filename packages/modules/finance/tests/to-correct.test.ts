import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { issueConfirmation, listConfirmations, voidConfirmation } from '../src/donations/confirmations';
import { saveNotice, supersedeNotice, voidNotice } from '../src/donations/notices';
import { countToCorrectInternal, toCorrectReasonsInternal } from '../src/donations/to-correct';
import { applyCorrectionInternal, requestAllocationCorrection } from '../src/ledger/corrections';
import { reverseInternal } from '../src/ledger/reverse';
import { financeConfirmations } from '../src/schema';
import { donationFixture, EXEMPTION, type DonationFixture } from './donation-fixture';

const rowOf = (f: DonationFixture, id: string) => f.deps.db.select().from(financeConfirmations).where(eq(financeConfirmations.id, id)).get()!;

describe('toCorrectReasonsInternal', () => {
  it('computes toCorrect for confirmations issued on a notice that was superseded afterwards', async () => {
    const f = await donationFixture();
    const first = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [(await f.donate({ cents: 1000 })).line.id] }));
    const second = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [(await f.donate({ cents: 2000 })).line.id] }));
    expect(countToCorrectInternal(f.deps.db)).toBe(0);
    const stored = JSON.stringify(f.deps.db.select().from(financeConfirmations).all());

    // Der neue Bescheid ersetzt den alten; beide Bestätigungen berufen sich auf den alten.
    unwrap(await saveNotice(f.deps, f.ctx, { ...EXEMPTION, noticeDate: '2026-03-20', assessmentPeriod: '2024' }));
    unwrap(await supersedeNotice(f.deps, f.ctx, { id: f.notice!.id, supersededOn: '2026-03-20' }));
    expect(toCorrectReasonsInternal(f.deps.db, rowOf(f, first.id))).toEqual(['noticeSuperseded']);
    expect(countToCorrectInternal(f.deps.db)).toBe(2);
    const listed = unwrap(await listConfirmations(f.deps, f.ctx, { tab: 'toCorrect' }));
    expect(listed.items.map((i) => i.id).sort()).toEqual([first.id, second.id].sort());
    expect(listed.items[0]!.toCorrect).toEqual(['noticeSuperseded']);
    // Berechnet, nie gespeichert.
    expect(JSON.stringify(f.deps.db.select().from(financeConfirmations).all())).toBe(stored);

    // Eine zurückgenommene Bestätigung ist nie „zu korrigieren“.
    unwrap(await voidConfirmation(f.deps, f.ctx, { id: second.id, note: 'neu ausgestellt', alreadySent: false }));
    expect(toCorrectReasonsInternal(f.deps.db, rowOf(f, second.id))).toEqual([]);
    expect(countToCorrectInternal(f.deps.db)).toBe(1);
  });

  it('computes toCorrect for a notice marked as recorded by mistake', async () => {
    const f = await donationFixture();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [(await f.donate()).line.id] }));
    unwrap(await voidNotice(f.deps, f.ctx, { id: f.notice!.id, note: 'Falsche Steuernummer' }));
    expect(toCorrectReasonsInternal(f.deps.db, rowOf(f, confirmation.id))).toEqual(['noticeVoided']);
  });

  it('computes toCorrect for a reversed or returned line', async () => {
    const f = await donationFixture();
    const returned = await f.donate({ cents: 5000 });
    const byReturn = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [returned.line.id] }));
    await f.giveBack(returned.line.id, 1000);
    expect(toCorrectReasonsInternal(f.deps.db, rowOf(f, byReturn.id))).toEqual(['lineReturned']);

    // Das Storno selbst sperrt die Bestätigung; eine Altbuchung (vor F6a) oder ein Fehler lässt sich nur am Schloss vorbei nachstellen.
    const reversed = await f.donate({ cents: 3000 });
    const byReversal = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [reversed.line.id] }));
    f.deps.db.transaction((tx) => unwrap(reverseInternal(tx, f.deps, f.ctx, { id: reversed.entry.id }, [])));
    expect(toCorrectReasonsInternal(f.deps.db, rowOf(f, byReversal.id))).toEqual(['lineReversed']);
    expect(countToCorrectInternal(f.deps.db)).toBe(2);
  });

  it('computes toCorrect for a contact changed by an applied correction, not for a changed address', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
    const { updateContact } = await import('@kompass/module-contacts');
    unwrap(await updateContact(f.deps, f.manage, { id: f.erika.id, street: 'Neue Straße 1' }));
    expect(toCorrectReasonsInternal(f.deps.db, rowOf(f, confirmation.id))).toEqual([]);

    // Im abgeschlossenen Jahr wartet die Korrektur — angewandt hier am Schloss vorbei.
    f.closeYear(f.years['2026']!.id);
    const requested = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'Falsche Spenderin' }));
    expect(requested.applied).toBe(false);
    f.deps.db.transaction((tx) => unwrap(applyCorrectionInternal(tx, f.deps, f.secondPerson, requested.correction.id, [])));
    expect(toCorrectReasonsInternal(f.deps.db, rowOf(f, confirmation.id))).toEqual(['contactChanged']);
  });
});

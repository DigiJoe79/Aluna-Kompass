import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { recordNameConsent } from '../src/allocation/name-consents';
import { reopenFiscalYear } from '../src/ledger/period';
import { saveAnnualAccountsExplanation } from '../src/reporting/annual-accounts-notes';
import { publishAnnualAccounts } from '../src/closing/annual-accounts-publish';
import { requestAnnualAccountsSignature, signAnnualAccounts } from '../src/closing/annual-accounts-sign';
import { annualAccountsDonorEffect, getAnnualAccountsState } from '../src/closing/annual-accounts-state';
import { boardMember, bookIn, finalizedAnnualAccounts } from './annual-accounts-j2-fixture';
import { ledgerFixture } from './helpers';

type Setup = Awaited<ReturnType<typeof finalizedAnnualAccounts>>;
const state = (s: Setup, ctx = s.publisher) => getAnnualAccountsState(s.f.deps, ctx, { fiscalYearId: s.y2025 }).then(unwrap);

describe('Zustand von Erläuterung, Abzeichnung und Webseite', () => {
  it('vor dem Festschreiben: nur die Erläuterung zählt, der Rest ist gedämpft', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const y = f.years['2025']!.id;
    unwrap(await saveAnnualAccountsExplanation(f.deps, f.ctx, { fiscalYearId: y, text: 'Ein gutes Jahr.' }));
    const st = unwrap(await getAnnualAccountsState(f.deps, f.ctx, { fiscalYearId: y }));
    expect(st).toMatchObject({ fiscalYearId: y, designation: '2025', finalVersion: null, doneCount: 1 });
    expect(st.explanation).toMatchObject({ state: 'done', length: 15, locked: false });
    expect(st.signature).toMatchObject({ state: 'muted', mutedReason: 'notFinal', signed: null, request: null, canSignSelf: false });
    expect(st.website).toMatchObject({ state: 'muted', mutedReason: 'notFinal', publication: null, previous: null });
  });

  it('nach dem Festschreiben, nach der Bitte und nach der Abzeichnung', async () => {
    const s = await finalizedAnnualAccounts();
    let st = await state(s);
    expect(st.finalVersion).toMatchObject({ reportId: s.report.id, documentNumber: s.report.documentNumber, shortHash: s.shortHash, corrected: null });
    expect(st.explanation).toMatchObject({ state: 'open', length: 0, locked: true });
    expect(st.signature).toMatchObject({ state: 'open', mutedReason: null, canSignSelf: false });
    expect(st.website).toMatchObject({ state: 'muted', mutedReason: 'notSigned' });
    expect(st.signature.representatives).toEqual([expect.objectContaining({ contactId: s.board.contactId, name: 'Vera Vorstand', office: 'Vorsitzende', mailState: 'ready' })]);
    const unlinked = await boardMember(s.f, { firstName: 'Olga', lastName: 'Ohnekonto', linked: false });
    expect((await state(s)).signature.representatives.find((r) => r.contactId === unlinked.contactId)?.mailState).toBe('noAccount');
    expect((await state(s, ctxWith(['finance.overview'], s.board.userId))).signature.canSignSelf).toBe(true);

    const req = unwrap(await requestAnnualAccountsSignature(s.f.deps, s.f.ctx, { reportId: s.report.id, contactId: s.board.contactId, dueAt: '2026-09-20' }));
    // Lücke 2 (Plan U1): wer gebeten hat und an wessen Konto die Bitte ging (Board 1f „… bittet Sie darum“).
    expect((await state(s)).signature.request).toEqual({ contactId: s.board.contactId, name: 'Vera Vorstand', requestedOn: '2026-09-05', followUpId: req.followUpId, requestedByUserId: s.f.ctx.userId, assigneeUserId: s.board.userId });

    unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: s.report.id }));
    st = await state(s);
    expect(st.signature).toMatchObject({ state: 'done', request: null, canSignSelf: false });
    expect(st.signature.signed).toMatchObject({ via: 'account', name: 'Vera Vorstand' });
    expect(st.website).toMatchObject({ state: 'open', mutedReason: null, publishNeeds: 'reason', blockedCode: null, mayPublish: true, assemblyOn: null });
    expect(st.doneCount).toBe(1);
    expect((await state(s, ctxWith(['finance.read'], s.f.userId))).website.mayPublish).toBe(false);
  });

  it('bereitgestellt, publiziert und nach dem Storno', async () => {
    const s = await finalizedAnnualAccounts();
    unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: s.report.id }));
    unwrap(await publishAnnualAccounts(s.f.deps, s.publisher, { reportId: s.report.id, earlyReason: 'itzDeadline' }));
    let st = await state(s);
    expect(st.website).toMatchObject({ state: 'done', publication: { earlyReason: 'itzDeadline', liveSince: null } });
    expect(st.doneCount).toBe(2);
    s.live.set(`annualAccounts:/finance/reports/annualAccounts?year=${s.y2025}`, '2026-09-05T12:00:00.000Z');
    expect((await state(s)).website.publication?.liveSince).toBe('2026-09-05T12:00:00.000Z');
    unwrap(await reopenFiscalYear(s.f.deps, s.f.ctx, { id: s.y2025, note: 'Buchung fehlte' }));
    st = await state(s);
    expect(st.finalVersion).toBeNull();
    expect(st.website).toMatchObject({ state: 'muted', mutedReason: 'notFinal', publication: null, previous: { cause: 'voided', finalizedAt: s.report.finalizedAt, wasLive: true } });
  });

  it('verlangt ein Leserecht', async () => {
    const s = await finalizedAnnualAccounts();
    const denied = await getAnnualAccountsState(s.f.deps, ctxWith([], s.f.userId), { fiscalYearId: s.y2025 });
    expect(denied.ok ? null : denied.error.type).toBe('forbidden');
    unwrap(await getAnnualAccountsState(s.f.deps, ctxWith(['finance.overview'], s.f.userId), { fiscalYearId: s.y2025 }));
  });
});

describe('Wirkung auf einen Großspender', () => {
  async function year() {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const make = async (lastName: string) => unwrap(await createContact(f.deps, ctxWith(['contacts.manage']), { kind: 'person', firstName: 'Gerd', lastName }));
    const big = await make('Groß');
    const small = await make('Klein');
    await bookIn(f, '2025-03-01', 'donations', 10000);
    await bookIn(f, '2025-03-02', 'donations', 2000, { contactId: big.id });
    await bookIn(f, '2025-03-03', 'donations', 600, { contactId: small.id });
    f.closeYear(f.years['2025']!.id);
    return { f, big, small };
  }

  it('nennt Anteil und ob der Name erscheint; unter 10 % nichts', async () => {
    const { f, big, small } = await year();
    expect(unwrap(await annualAccountsDonorEffect(f.deps, f.ctx, { contactId: big.id }))).toEqual({ designation: '2025', amountCents: 2000, sharePermille: 159, named: false });
    expect(unwrap(await annualAccountsDonorEffect(f.deps, f.ctx, { contactId: small.id }))).toBeNull();
    unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: big.id, on: '2026-01-10', fromYear: 2025 }));
    expect(unwrap(await annualAccountsDonorEffect(f.deps, f.ctx, { contactId: big.id }))?.named).toBe(true);
    const denied = await annualAccountsDonorEffect(f.deps, ctxWith(['finance.overview'], f.userId), { contactId: big.id });
    expect(denied.ok ? null : denied.error.type).toBe('forbidden');
  });

  it('gilt fürs letzte beendete Jahr, auch wenn es wiedergeöffnet ist (Bildabnahme 0.4.5 W-1/W-2)', async () => {
    const { f, big } = await year();
    unwrap(await reopenFiscalYear(f.deps, f.ctx, { id: f.years['2025']!.id, note: 'Buchung fehlte' }));
    expect(unwrap(await annualAccountsDonorEffect(f.deps, f.ctx, { contactId: big.id }))).toEqual({ designation: '2025', amountCents: 2000, sharePermille: 159, named: false });
  });
});

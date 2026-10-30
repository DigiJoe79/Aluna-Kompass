import { unwrap } from '@kompass/core';
import { loadAllViews } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { financeModule } from '../src/manifest';
import { publishAnnualAccounts } from '../src/closing/annual-accounts-publish';
import { signAnnualAccounts } from '../src/closing/annual-accounts-sign';
import { finalizedAnnualAccounts } from './annual-accounts-j2-fixture';

/**
 * Was die Dienste annehmen, muss die Sicht liefern (AGENTS „Sichten nie strenger als ihre Dienste“, Muster der Tiere):
 * eine Jahresrechnung mit den Pflichtschritten festgeschrieben, abgezeichnet, veröffentlicht — jede Sicht lädt.
 */
describe('finance views hold against what the services accept', () => {
  it('a published annual accounts row loads through every view', async () => {
    const s = await finalizedAnnualAccounts();
    unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: s.report.id }));
    unwrap(await publishAnnualAccounts(s.f.deps, s.publisher, { reportId: s.report.id, earlyReason: 'itzDeadline' }));
    const views = loadAllViews(s.f.deps, financeModule);
    expect(views.annualAccounts).toEqual([expect.objectContaining({ year: '2025', webVersionOn: null, replacesFinalizedOn: null })]);
  });
});

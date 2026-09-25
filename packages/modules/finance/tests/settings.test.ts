import { setSetting, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { financeModule } from '../src/manifest';
import { setupFinance } from './helpers';

describe('finance settings', () => {
  it('the switch that lets an agent finalize can only be flipped by a person at the screen', async () => {
    const { deps } = setupFinance();
    const viaMcp = { ...ctxWith(['settings.manage']), channel: 'mcp' as const };
    const res = await setSetting(deps, viaMcp, { key: 'finance.mcpHumanOnlyAllowed', value: true });
    expect(res.ok).toBe(false);
    expect(unwrap(await setSetting(deps, { ...ctxWith(['settings.manage']), channel: 'ui' as const }, { key: 'finance.mcpHumanOnlyAllowed', value: true }))).toBeTruthy();
  });

  it('offers expense waivers only after the association switches them on (Spec E13)', () => {
    const def = (financeModule.settings ?? []).find((s) => s.key === 'finance.expenseWaiversEnabled');
    expect(def?.default).toBe(false);
  });

  it('declares every setting of the spec with a default', () => {
    expect((financeModule.settings ?? []).map((s) => s.key).sort()).toEqual([
      'finance.batchMinimumCents',
      'finance.cashDonationAlertCents',
      'finance.expenseWaiversEnabled',
      // F8a — Anspruchsgrundlage der Aufwandsspenden.
      'finance.expenseWaiverBasisText',
      'finance.isEntrepreneurOrHasVatId',
      'finance.lastStatementWarnDays',
      'finance.mcpHumanOnlyAllowed',
      'finance.membershipFeesCertifiable',
      'finance.noticeExpiryWarnMonths',
      'finance.proofGraceDays',
      'finance.roundAmountFromCents',
      'finance.setupCategoriesConfirmedAt',
      'finance.setupTaxConfirmedAt',
      'finance.statementSufficesBelowCents',
      'finance.uploadLimitMb',
      'finance.voucherTypes',
      // F5 — Vorschläge der Arbeitsliste.
      'finance.pairMatchDays',
      'finance.pairFeeToleranceCents',
      'finance.matchEntryDays',
      'finance.cashKeywords',
    ].sort());
    expect(financeModule.settings!.find((s) => s.key === 'finance.mcpHumanOnlyAllowed')).toMatchObject({ default: false, uiOnly: true });
  });

  it('keeps the basis of expense waivers as text up to 500 characters, empty until the association writes it down (F8a)', () => {
    const setting = financeModule.settings!.find((s) => s.key === 'finance.expenseWaiverBasisText')!;
    // Leer, nicht „Vereinbarung vom … / Satzung § …“: Der Wortlaut ist der Hinweis im Feld; ein Platzhalter als Wert
    // stünde sonst als Anspruchsgrundlage auf jedem Antrag, und die Einrichtung hielte den Schritt für erledigt.
    expect(setting.default).toBe('');
    expect(setting.schema.safeParse('Satzung § 9 Abs. 2').success).toBe(true);
    expect(setting.schema.safeParse('x'.repeat(500)).success).toBe(true);
    expect(setting.schema.safeParse('x'.repeat(501)).success).toBe(false);
    expect(setting.schema.safeParse(null).success).toBe(false);
  });
});

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

  it('declares every setting of the spec with a default', () => {
    expect((financeModule.settings ?? []).map((s) => s.key).sort()).toEqual([
      'finance.batchMinimumCents',
      'finance.cashDonationAlertCents',
      'finance.expenseWaiversEnabled',
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
    ].sort());
    expect(financeModule.settings!.find((s) => s.key === 'finance.mcpHumanOnlyAllowed')).toMatchObject({ default: false, uiOnly: true });
  });
});

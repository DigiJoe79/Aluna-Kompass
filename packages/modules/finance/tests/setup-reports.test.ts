import { readSetting, unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { setReportSettings } from '../src/ledger/setup';
import { setupFinance } from './helpers';

/** Rechenschaft A3 Task 6b: die zwei Einstellungen des Kassenberichts, gespeichert mit dem Panel „Berichte“. */
describe('setReportSettings', () => {
  it('writes the statute reference and the signature line, with audit', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await setReportSettings(deps, ctx, { statuteReference: '  § 9 Nr. 3 der Satzung ', cashReportSignature: true }));
    expect(readSetting(deps, 'finance.reports.statuteReference')).toBe('§ 9 Nr. 3 der Satzung');
    expect(readSetting(deps, 'finance.reports.cashReportSignature')).toBe(true);
    expect(auditEntry(deps, 'finance.setup.setting')).toBeDefined();
  });

  it('refuses without finance.setup and longer than 80 characters', async () => {
    const { deps, ctx } = setupFinance();
    expect(await setReportSettings(deps, ctxWith(['finance.read'], 'R'), { statuteReference: '', cashReportSignature: false })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.setup' } });
    expect(await setReportSettings(deps, ctx, { statuteReference: 'x'.repeat(81), cashReportSignature: false })).toMatchObject({ ok: false, error: { type: 'validation', issues: [expect.objectContaining({ path: 'statuteReference' })] } });
  });

  it('Rechenschaft C: stores whether the treasurer is a statutory board member, keeps it when not sent', async () => {
    const { deps, ctx } = setupFinance();
    expect(readSetting(deps, 'finance.reports.treasurerIsStatutoryBoard')).toBeNull();
    unwrap(await setReportSettings(deps, ctx, { statuteReference: '', cashReportSignature: false, treasurerIsStatutoryBoard: false }));
    expect(readSetting(deps, 'finance.reports.treasurerIsStatutoryBoard')).toBe(false);
    unwrap(await setReportSettings(deps, ctx, { statuteReference: '', cashReportSignature: false }));
    expect(readSetting(deps, 'finance.reports.treasurerIsStatutoryBoard')).toBe(false);
  });

  it('J2: stores whether the general assembly approves the annual accounts, keeps it when not sent', async () => {
    const { deps, ctx } = setupFinance();
    expect(readSetting(deps, 'finance.reports.assemblyApprovesAccounts')).toBe(false);
    unwrap(await setReportSettings(deps, ctx, { statuteReference: '', cashReportSignature: false, assemblyApprovesAccounts: true }));
    expect(readSetting(deps, 'finance.reports.assemblyApprovesAccounts')).toBe(true);
    unwrap(await setReportSettings(deps, ctx, { statuteReference: '', cashReportSignature: false }));
    expect(readSetting(deps, 'finance.reports.assemblyApprovesAccounts')).toBe(true);
  });
});

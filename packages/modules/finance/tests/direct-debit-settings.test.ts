import { readSetting, unwrap, writeSettingInternal } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { schema } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { isValidCreditorId, normalizeCreditorId } from '../src/direct-debit/creditor-id';
import { saveSepaSettings, sepaSetupState } from '../src/direct-debit/settings';
import { createAccount } from '../src/ledger/accounts';
import { getSetupStatus } from '../src/ledger/setup';
import { financeModule } from '../src/manifest';
import { setupFinance } from './helpers';

type Deps = ReturnType<typeof setupFinance>['deps'];
const write = (deps: Deps, key: string, value: unknown) => deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), key, value));

describe('creditor id (Gläubiger-Identifikationsnummer)', () => {
  it('accepts the test id of the Bundesbank and refuses a wrong check digit (Review Focus 1)', () => {
    expect(isValidCreditorId('DE98ZZZ09999999999')).toBe(true);
    expect(isValidCreditorId('DE98ZZZ09999999998')).toBe(false);
    expect(isValidCreditorId('DE97ZZZ09999999999')).toBe(false);
  });

  it('ignores the business code for the check digit and refuses a bad format', () => {
    // Die Geschäftsbereichskennung (Zeichen 5–7) geht nicht in die Prüfziffer ein.
    expect(isValidCreditorId('DE98ABC09999999999')).toBe(true);
    for (const bad of ['', 'DE98', 'D98ZZZ09999999999', 'DE9XZZZ09999999999', 'DE98ZZZ0999999999-']) expect(isValidCreditorId(bad), bad).toBe(false);
  });

  it('normalizes lower case and spaces', () => {
    expect(normalizeCreditorId(' de98 zzz 0999 9999 999 ')).toBe('DE98ZZZ09999999999');
    expect(isValidCreditorId('de98zzz09999999999')).toBe(true);
  });
});

describe('direct debit settings', () => {
  it('declares the settings with their defaults', () => {
    const { deps } = setupFinance();
    expect(readSetting(deps, 'finance.sepa.enabled')).toBe(false);
    expect(readSetting(deps, 'finance.sepa.creditorId')).toBeNull();
    expect(readSetting(deps, 'finance.sepa.creditorName')).toBeNull();
    expect(readSetting(deps, 'finance.sepa.accountId')).toBeNull();
    expect(readSetting(deps, 'finance.sepa.leadBusinessDays')).toBe(2);
    expect(readSetting(deps, 'finance.sepa.maxLeadDays')).toBe(14);
    expect(readSetting(deps, 'finance.sepa.preNotificationDays')).toBe(14);
    expect(readSetting(deps, 'finance.sepa.batchBooking')).toBe(true);
    expect(readSetting(deps, 'finance.sepa.mandateReferenceFormat')).toEqual({ prefix: 'MND-', digits: 6 });
  });

  it('stores the creditor id normalized and refuses a wrong check digit', () => {
    const { deps } = setupFinance();
    expect(write(deps, 'finance.sepa.creditorId', 'de98zzz09999999999').ok).toBe(true);
    expect(readSetting(deps, 'finance.sepa.creditorId')).toBe('DE98ZZZ09999999999');
    expect(write(deps, 'finance.sepa.creditorId', 'DE98ZZZ09999999998')).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('keeps the limits and the reference format within SEPA bounds', () => {
    const { deps } = setupFinance();
    expect(write(deps, 'finance.sepa.leadBusinessDays', 0).ok).toBe(false);
    expect(write(deps, 'finance.sepa.leadBusinessDays', 11).ok).toBe(false);
    expect(write(deps, 'finance.sepa.maxLeadDays', 61).ok).toBe(false);
    expect(write(deps, 'finance.sepa.preNotificationDays', 31).ok).toBe(false);
    expect(write(deps, 'finance.sepa.creditorName', 'x'.repeat(71)).ok).toBe(false);
    expect(write(deps, 'finance.sepa.mandateReferenceFormat', { prefix: 'Ä-', digits: 6 }).ok).toBe(false);
    expect(write(deps, 'finance.sepa.mandateReferenceFormat', { prefix: 'x'.repeat(21), digits: 6 }).ok).toBe(false);
    expect(write(deps, 'finance.sepa.mandateReferenceFormat', { prefix: 'M', digits: 11 }).ok).toBe(false);
    expect(write(deps, 'finance.sepa.mandateReferenceFormat', { prefix: 'VEREIN/', digits: 4 }).ok).toBe(true);
  });

  it('brings the permission finance.directDebit', () => {
    expect(financeModule.permissions).toContain('finance.directDebit');
  });
});

describe('sepaSetupState and the checklist', () => {
  it('names what is missing; the main account counts when no account is set', async () => {
    const { deps, ctx } = setupFinance();
    expect(sepaSetupState(deps)).toEqual({ enabled: false, ready: false, missing: ['creditorId', 'account'] });
    write(deps, 'finance.sepa.enabled', true);
    write(deps, 'finance.sepa.creditorId', 'DE98ZZZ09999999999');
    expect(sepaSetupState(deps)).toEqual({ enabled: true, ready: false, missing: ['account'] });
    unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
    expect(sepaSetupState(deps)).toEqual({ enabled: true, ready: true, missing: [] });
    const cash = unwrap(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash' }));
    write(deps, 'finance.sepa.accountId', cash.id);
    expect(sepaSetupState(deps).missing).toEqual(['accountIban']);
  });

  it('the checklist reports a missing creditor id only while direct debit is enabled', async () => {
    const { deps, ctx } = setupFinance();
    const step = async () => unwrap(await getSetupStatus(deps, ctx)).steps.find((s) => s.key === 'directDebit')!;
    expect(await step()).toMatchObject({ required: false, done: true, detail: {}, permission: 'finance.setup' });
    write(deps, 'finance.sepa.enabled', true);
    expect(await step()).toMatchObject({ done: false, detail: { missing: 'creditorId,account', permission: 'finance.directDebit' } });
    write(deps, 'finance.sepa.creditorId', 'DE98ZZZ09999999999');
    unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
    expect(await step()).toMatchObject({ done: true, detail: { permission: 'finance.directDebit' } });
  });
});

describe('saveSepaSettings', () => {
  it('writes only what changed, normalized, one audit entry per setting', async () => {
    const { deps, ctx } = setupFinance();
    const account = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
    const result = unwrap(await saveSepaSettings(deps, ctx, { enabled: true, creditorId: ' de98 zzz09999999999', creditorName: '', accountId: account.id, leadBusinessDays: 2, preNotificationDays: 10 }));
    expect(result.changed).toEqual(['finance.sepa.enabled', 'finance.sepa.creditorId', 'finance.sepa.accountId', 'finance.sepa.preNotificationDays']);
    expect(readSetting(deps, 'finance.sepa.creditorId')).toBe('DE98ZZZ09999999999');
    expect(readSetting(deps, 'finance.sepa.creditorName')).toBeNull();
    const audit = deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.setup.setting');
    expect(audit.map((a) => a.entityId)).toEqual(result.changed);
  });

  it('refuses a wrong check digit at the field and an unknown account', async () => {
    const { deps, ctx } = setupFinance();
    expect(await saveSepaSettings(deps, ctx, { creditorId: 'DE98ZZZ09999999998' })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'creditorId', message: 'invalidCreditorId' }] } });
    expect(await saveSepaSettings(deps, ctx, { accountId: 'nope' })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'accountId' }] } });
    expect(await saveSepaSettings(deps, ctx, { leadBusinessDays: 0 })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(readSetting(deps, 'finance.sepa.creditorId')).toBeNull();
  });

  it('needs finance.setup', async () => {
    const { deps, ctx } = setupFinance(['finance.read', 'finance.directDebit']);
    expect(await saveSepaSettings(deps, ctx, { enabled: true })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(readSetting(deps, 'finance.sepa.enabled')).toBe(false);
  });
});

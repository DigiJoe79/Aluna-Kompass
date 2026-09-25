import type { ConfirmationCheckResult } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { donationTab, issueAllowed, signatureMode, visibleChecks } from '@/lib/finance/donations';

const check = (over: Partial<ConfirmationCheckResult> = {}): ConfirmationCheckResult => ({
  kind: 'money',
  contactId: 'C1',
  lines: [],
  checks: [
    { key: 'final', applies: true, done: true, blocked: false, detail: {}, remedy: null, warning: null },
    { key: 'inKindDetails', applies: false, done: true, blocked: false, detail: {}, remedy: null, warning: null },
    { key: 'signerValid', applies: true, done: true, blocked: false, detail: {}, remedy: null, warning: null },
  ],
  ok: true,
  warnings: [],
  notice: null,
  machine: { complete: true, signer: null, missing: [] },
  expenseWaiver: false,
  ...over,
});

describe('Zuwendungsbestätigungen in der Oberfläche (F6a Task 7)', () => {
  it('reads the tab from the address and falls back to the issued list', () => {
    expect(donationTab('uncertified')).toBe('uncertified');
    expect(donationTab('toCorrect')).toBe('toCorrect');
    expect(donationTab('needsSignature')).toBe('needsSignature');
    expect(donationTab(undefined)).toBe('issued');
    expect(donationTab('anything')).toBe('issued');
  });

  it('shows only the checks that apply to this donation, in the order of the service', () => {
    expect(visibleChecks(check()).map((c) => c.key)).toEqual(['final', 'signerValid']);
  });

  it('names the signature mode from the check, never as a choice', () => {
    expect(signatureMode(check())).toBe('machine');
    const field = check({ checks: [{ key: 'signerValid', applies: false, done: true, blocked: false, detail: {}, remedy: null, warning: 'signatureField' }] });
    expect(signatureMode(field)).toBe('signatureField');
  });

  it('allows issuing only when nothing blocks — and before the oldest notice only with a reason', () => {
    expect(issueAllowed(check(), '')).toBe(true);
    expect(issueAllowed(check({ ok: false }), '')).toBe(false);
    const early = check({ warnings: ['beforeOldestNotice'] });
    expect(issueAllowed(early, '  ')).toBe(false);
    expect(issueAllowed(early, 'Zusage lag schriftlich vor')).toBe(true);
    expect(issueAllowed(null, '')).toBe(false);
  });
});

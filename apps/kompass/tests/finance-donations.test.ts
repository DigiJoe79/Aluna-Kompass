import type { ConfirmationCheck, ConfirmationCheckResult } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { donationTab, groupChecks, issueAllowed, signatureMode, visibleChecks } from '@/lib/finance/donations';

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

  describe('groupChecks (N3 C1-2/C1-3): Fehlt noch · Bitte ansehen · Erfüllt · Trifft nicht zu', () => {
    const c = (key: ConfirmationCheck['key'], over: Partial<ConfirmationCheck> = {}): ConfirmationCheck => ({ key, applies: true, done: true, blocked: false, detail: {}, remedy: null, warning: null, ...over });
    const shape = (checks: ConfirmationCheck[]) => groupChecks(checks).map((g) => [g.group, g.checks.map((x) => x.key)]);

    it('leaves out empty groups — nothing blocked, nothing to review', () => {
      expect(shape([c('final'), c('inKindDetails', { applies: false }), c('signerValid')])).toEqual([
        ['done', ['final', 'signerValid']],
        ['notApplicable', ['inKindDetails']],
      ]);
      expect(groupChecks([])).toEqual([]);
    });

    it('puts checks that do not apply under „Trifft nicht zu“, even with a warning', () => {
      expect(shape([c('signerValid', { applies: false, warning: 'signatureField' }), c('expenseWaiverEnabled', { applies: false })])).toEqual([['notApplicable', ['signerValid', 'expenseWaiverEnabled']]]);
    });

    it('puts warnings under „Bitte ansehen“ and blocked checks under „Fehlt noch“, in the order of the checks', () => {
      const checks = [
        c('final'),
        c('contactComplete', { warning: 'organization' }),
        c('organizationAddress', { done: false, blocked: true, remedy: { href: '/admin/settings', labelKey: 'completeOrganization' } }),
        c('noticeValid', { done: false, blocked: true, warning: 'beforeOldestNotice' }),
        c('signerValid', { done: false, warning: 'signatureField' }),
        c('inKindDetails', { applies: false }),
      ];
      expect(shape(checks)).toEqual([
        ['missing', ['organizationAddress', 'noticeValid']],
        ['review', ['contactComplete', 'noticeValid', 'signerValid']],
        ['done', ['final']],
        ['notApplicable', ['inKindDetails']],
      ]);
    });
  });
});

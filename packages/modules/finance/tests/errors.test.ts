import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FINANCE_ERRORS, financeConflict, type FinanceErrorCode } from '../src/errors';

const SRC = path.resolve(import.meta.dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });

describe('finance errors', () => {
  it('every error names the parameters its text needs, each with its kind (A6: the text is in the language file)', () => {
    for (const [code, params] of Object.entries(FINANCE_ERRORS)) for (const kind of Object.values(params)) expect(['text', 'date', 'cents', 'evidenceKind'], code).toContain(kind);
  });

  it('carries code, language key and raw parameters — dates as YYYY-MM-DD, amounts in cents', () => {
    expect(financeConflict('cashWouldGoNegative', { account: 'K1', date: '2026-03-04', amount: -1250 })).toEqual({
      ok: false,
      error: { type: 'conflict', code: 'cashWouldGoNegative', message: 'cashWouldGoNegative', messageKey: 'finance.errors.cashWouldGoNegative', params: { account: 'K1', date: '2026-03-04', amount: -1250 } },
    });
    expect(financeConflict('humanOnly')).toMatchObject({ error: { messageKey: 'finance.errors.humanOnly', params: {} } });
  });

  it('knows the errors of the work list, rules and contact ibans (F5)', () => {
    for (const code of ['ruleNeedsCondition', 'ruleCategoryInactive', 'suggestionStale', 'transactionAlreadyBooked', 'entryLineNotBindable', 'foreignNeedsHolder', 'contactIbanTaken', 'voucherSearchNeedsRead', 'batchNothingReviewed']) {
      expect(Object.keys(FINANCE_ERRORS), code).toContain(code);
    }
  });

  it('knows the errors of notices and confirmations (F6a)', () => {
    const codes = [
      'noticeVoided', 'noticeSuperseded', 'noticeNotValidAt', 'noNoticeValidAt', 'noticeAfterExemption', 'confirmationLineNotFinal', 'confirmationLineReversed', 'confirmationIncomeNotCertifiable',
      'confirmationContactIncomplete', 'confirmationOrganizationIncomplete', 'confirmationLineAlreadyConfirmed', 'confirmationAmountNotPositive', 'confirmationEntryUndocumented', 'confirmationInKindDetailsMissing',
      'confirmationInKindMixed', 'confirmationTypeInactive', 'confirmationExpenseWaiversDisabled', 'confirmationBeforeExemptionStart', 'confirmationAlreadyVoided', 'confirmationAlreadySent',
      'confirmationSignedAlready', 'signerOverlaps', 'facsimileTooLarge', 'facsimileNotImage', 'entryLockedByConfirmation', 'contactLockedByConfirmation', 'inKindLineOnly',
    ];
    for (const code of codes) expect(Object.keys(FINANCE_ERRORS), code).toContain(code);
    expect(Object.keys(FINANCE_ERRORS)).not.toContain('confirmationPreNoticeNeedsReason');
  });

  it('knows the errors of the confirmation run and its bundles (F6b)', () => {
    for (const code of ['runNothingToIssue', 'runAlreadyFinished', 'runBlockedNoNotice', 'runBlockedOrganizationIncomplete', 'runItemNotPending', 'bundleToolsMissing', 'bundleEmpty', 'dispatchNothingMachine']) {
      expect(Object.keys(FINANCE_ERRORS), code).toContain(code);
    }
  });

  it('knows the errors of expense claims, approvals and waivers (F8a)', () => {
    const codes = [
      'expenseNeedsContactLink', 'expenseNotDraft', 'expenseNotSubmitted', 'expenseNothingToSubmit', 'expensePositionNeedsReceipt', 'expenseTripNeedsKm', 'expenseIbanOrWaiver',
      'expenseOwnClaim', 'expenseSameContact', 'expenseCategoryRequired', 'expenseWaiversDisabled', 'waiverAgreedAfterPosition', 'waiverLateNeedsReason', 'waiverFundsInsufficient',
      'waiverDeclarationMissing', 'waiverNotConfirmed', 'expenseFileNotPdf', 'expenseFileTooLarge', 'expenseNotOwner', 'expenseNotRejected',
    ];
    for (const code of codes) expect(Object.keys(FINANCE_ERRORS), code).toContain(code);
    for (const code of ['waiverSignedAlready', 'expenseWaiverCategoryMissing']) expect(Object.keys(FINANCE_ERRORS), code).toContain(code);
  });

  it('knows the errors of partners, payments to partners and their evidence (F7)', () => {
    const codes = [
      'partnerBasisNotForAgent', 'partnerBasisNeedsOrganization', 'partnerBasisOverrideNeedsReason', 'partnerPaymentNotSubmitted', 'partnerPaymentNotRejected',
      'allocationLineAlreadyAssigned', 'paidLinesRequired', 'paidLineNotEligible', 'evidenceExplanationMissing', 'partnerProfileInUse', 'partnerNoticeNotApplicable', 'partnerPaymentOwnCreator',
      'evidenceKindMissing', 'evidenceAmountMissing', 'evidenceCoverageIncomplete', 'evidenceNotYetPaid', 'evidenceAlreadyAcknowledged',
      'partnerNoticeReasonRequired', 'partnerOverdueReasonRequired',
    ];
    for (const code of codes) expect(Object.keys(FINANCE_ERRORS), code).toContain(code);
  });

  it('knows the errors of reserved funds and purpose transfers (F8b)', () => {
    const codes = [
      'reserveResolutionRequired', 'reservePurposeTextRequired', 'reserveInsufficient', 'reserveDissolved', 'reserveMovementOutOfOrder', 'reserveInUse', 'reserveCarryForwardIncomplete',
      'movementDateInFuture', 'transferSamePurpose', 'transferNoPurposes', 'transferDocumentRequired', 'transferNotSubmitted', 'transferOwn', 'transferDateInFuture',
      'purposeReopenNeedsReason', 'resolutionTypeInactive', 'resolutionFileNotPdf', 'resolutionFileTooLarge',
    ];
    for (const code of codes) expect(Object.keys(FINANCE_ERRORS), code).toContain(code);
    expect(financeConflict('transferOwn')).toMatchObject({ error: { code: 'transferOwn' } });
  });

  it('kein Konflikt trägt einen deutschen Satz aus dem Modulcode als Parameter (Befund 49)', () => {
    // Ein Parameter ist ein Wert (Nummer, Name, Datum, Betrag), nie ein Satzstück: Grund und Wortlaut stehen in der
    // Sprachdatei, je Fall ein eigener Code. Gesucht wird ein Wortlaut mit Leerzeichen oder Umlaut als Parameterwert —
    // direkt im Aufruf oder als Konstante (`BLOCKED_RUN_TEXT`, `reasonFor`, `location`).
    const german = /(['`])[^'`\n]*(?:[äöüÄÖÜß]|[A-Za-z]{2,} [a-zäöüß]{2,})[^'`\n]*\1/;
    const offenders: string[] = [];
    for (const file of files(SRC).filter((f) => f.endsWith('.ts') && !f.includes(`${path.sep}templates${path.sep}`))) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const call of code.matchAll(/financeConflict\('\w+',\s*\{[^}]*\}/g)) if (german.test(call[0])) offenders.push(`${path.relative(SRC, file)}: ${call[0]}`);
      if (/BLOCKED_RUN_TEXT|const reasonFor = |const location = /.test(code)) offenders.push(`${path.relative(SRC, file)}: Satzstück als Konstante`);
    }
    expect(offenders).toEqual([]);
    for (const code of ['entryLocked', 'contactLocked', 'runBlocked']) expect(Object.keys(FINANCE_ERRORS), code).not.toContain(code);
    for (const code of ['entryLockedByPartnerPayment', 'entryLockedByPendingPartnerPayment', 'contactLockedByPartnerPayment', 'contactLockedByPendingPartnerPayment', 'statementUnreadableAtLine']) expect(Object.keys(FINANCE_ERRORS), code).toContain(code);
  });

  it('is the only way the module raises a conflict', () => {
    const offenders = files(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith(`${path.sep}errors.ts`)).filter((f) => /\bconflict\(/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { ReviewNotice } from '@/app/(shell)/finance/tax/review-notice';
import { filingDocumentsOf, reviewNoticeKind } from '@/app/(shell)/finance/tax/review-state';

afterEach(cleanup);

const filed = { filedOn: '2026-05-31', reviewDue: false, filedFiguresMissing: false };

/** B9 (Spec 0.5.2 § 6): welcher Hinweis über den Werten gilt, und zu welcher Abgabe die Dokumentzeilen gehören. */
describe('Steuererklärung: Hinweis nach der Abgabe', () => {
  it('warns while a review is open, also after a reopening; without one only a voided version brings a hint', () => {
    expect(reviewNoticeKind({ ...filed, filedOn: null }, true)).toBeNull();
    expect(reviewNoticeKind(filed, false)).toBeNull();
    expect(reviewNoticeKind({ ...filed, reviewDue: true }, false)).toBe('review');
    expect(reviewNoticeKind({ ...filed, reviewDue: true }, true)).toBe('review');
    expect(reviewNoticeKind(filed, true)).toBe('unchanged');
    expect(reviewNoticeKind({ ...filed, filedFiguresMissing: true }, true)).toBe('unknown');
  });

  it('names the changed lines and attachments in the warning', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <ReviewNotice kind="review" periodId="p1" causes={[{ kind: 'line', line: '9', year: '2025' }, { kind: 'line', line: '21' }, { kind: 'attachment', report: 'reserveStatement', year: '2025' }]} />
      </NextIntlClientProvider>,
    );
    const notice = screen.getByTestId('tax-review');
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toMatch(/9.*2025.*21.*2025/);
  });

  it('puts the document rows at the latest filing', () => {
    const documents = { filedReturn: { documentId: 'D1', documentNumber: 'STE-1' } };
    expect(filingDocumentsOf({ documents, amendments: [] })).toEqual({ target: 'period', documents });
    const amendment = { id: 'A2', filedOn: '2026-09-01', reportId: 'R', at: 't', documents: { transmissionProtocol: { documentId: 'D3', documentNumber: 'STE-3' } }, cause: [] };
    expect(filingDocumentsOf({ documents, amendments: [{ ...amendment, id: 'A1', documents: {} }, amendment] })).toEqual({ target: 'amendment', amendmentId: 'A2', documents: amendment.documents });
  });
});

import type { WaiverCheck } from '@kompass/module-finance';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WaiverChecks } from '@/app/(shell)/finance/approvals/waiver-checks';
import messages from '../messages/de.json';

const checks = (blockedBy: 'agreedAfterPosition' | 'notConfirmed' | null): WaiverCheck[] => [
  { key: 'claimAgreed', done: blockedBy === null, blocked: blockedBy !== null, warning: null, detail: { agreedOn: '2026-09-27', earliestPosition: '2026-09-22', blockedBy } },
  { key: 'timely', done: true, blocked: false, warning: null, detail: { deadline: '2026-12-22' } },
  { key: 'fundsAvailable', done: true, blocked: false, warning: null, detail: { date: '2026-09-28', freeCents: 10000, amountCents: 3000 } },
  { key: 'declaration', done: false, blocked: true, warning: null, detail: { documentId: null } },
  { key: 'declarationSigned', done: false, blocked: true, warning: null, detail: { documentId: null } },
];

const render = (list: WaiverCheck[]) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <WaiverChecks
        checks={list}
        basis={{ text: 'Satzung § 7', agreedOn: '2026-09-27' }}
        state={{ declaredOn: '2026-09-28', claimAgreedConfirmed: false, lateReason: '' }}
        onChange={() => {}}
        declaration={{ href: null, signedHref: null }}
        onCreateDeclaration={() => {}}
        onUploadSigned={() => {}}
        busy={false}
      />
    </NextIntlClientProvider>,
  );

/** Prüfer-Fixrunde 28.09., Punkt 2: Bei der Datumssperre gibt es keinen Knopf, der dann doch verweigert wird. */
describe('WaiverChecks', () => {
  it('bietet „Verzichtserklärung erzeugen“ an, solange nur das Häkchen fehlt', () => {
    expect(render(checks('notConfirmed'))).toContain(messages.finance.approvals.waiver.declarationCreate);
  });

  it('zeigt bei einer Grundlage nach der frühesten Position keinen Knopf, sondern den Grund — aus dem Datenstand der Vorprüfung', () => {
    const markup = render(checks('agreedAfterPosition'));
    expect(markup).not.toContain(messages.finance.approvals.waiver.declarationCreate);
    expect(markup).toContain('data-testid="waiver-declaration-blocked"');
  });
});

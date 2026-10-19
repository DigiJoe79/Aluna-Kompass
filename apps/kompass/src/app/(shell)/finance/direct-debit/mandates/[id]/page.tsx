import { hasPermission, readSetting, resolveRecordLabel, todayIn } from '@kompass/core';
import { getDocumentRecord } from '@kompass/module-dms';
import { getMandate, listDirectDebitReturns } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { readAllPages } from '@/lib/read-all-pages';
import { requireSession } from '@/lib/request-context';
import { MandateView } from './mandate-view';

/** Mandat (Handoff 2a § 1.4, 14a–14c): Vorgang in einer Spalte (`task`), Titel ist die Referenz. */
export default async function MandatePage({ params }: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  const { id } = await params;
  const t = await getTranslations('finance.directDebit.list');
  const mandate = await getMandate(deps, ctx, { id });
  if (!mandate.ok) {
    if (mandate.error.type === 'notFound') notFound();
    return <Page width="task"><ForbiddenCard permission="finance.read" /></Page>;
  }
  const m = mandate.value;
  const returns = await readAllPages((page) => listDirectDebitReturns(deps, ctx, { mandateId: id, ...page }), (v) => v.items);
  // Wofür das Mandat steht, mit Link: Mitgliedschaft über `recordLabels` der Mitglieder, Zusage auf ihre Seite.
  const usages = m.usedFor.map((u) => ({ kind: u.kind === 'pledge' ? ('pledge' as const) : ('membership' as const), href: u.kind === 'pledge' ? `/finance/direct-debit/pledges/${u.id}` : (resolveRecordLabel(deps, ctx, u.kind, u.id)?.href ?? null) }));
  const signed = m.signedDocumentId ? await getDocumentRecord(deps, ctx, m.signedDocumentId) : null;
  return (
    <MandateView
      back={{ href: '/finance/direct-debit', label: t('title') }}
      mandate={{
        id: m.id,
        reference: m.reference,
        state: m.state,
        payer: m.contactName ?? m.debtorName,
        contactId: m.contactId,
        debtorName: m.debtorName,
        iban: m.iban,
        sequence: m.sequence,
        preparedOn: m.preparedOn,
        signedOn: m.signedOn,
        signedNumber: signed?.ok ? signed.value.number : null,
        endedOn: m.endedOn,
        lastCollectedOn: m.lastCollectedOn,
        expiresOn: m.expiresOn,
      }}
      usages={usages}
      creditorId={readSetting<string | null>(deps, 'finance.sepa.creditorId')}
      changes={m.changes.map((c) => ({ id: c.id, field: c.field, before: c.before, after: c.after, validFrom: c.validFrom, createdAt: c.createdAt }))}
      collections={m.collections}
      returns={(returns.ok ? returns.value : []).map((r) => ({ id: r.id, runId: r.runId, collectionDate: r.collectionDate, returnedOn: r.returnedOn, returnCode: r.returnCode, amountCents: r.amountCents, status: r.status }))}
      today={todayIn(deps)}
      canPrepare={hasPermission(ctx, 'finance.directDebit')}
    />
  );
}

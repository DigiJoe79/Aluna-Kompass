import { hasPermission, isoNow } from '@kompass/core';
import { getDocumentRecord } from '@kompass/module-dms';
import { freeReserveCap, listFiscalYears, listPurposes, listReserves, valueAt } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LimitProgress, limitState } from '@/components/finance/limit-progress';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { formatEuro } from '@/lib/finance/amount';
import { requireSession } from '@/lib/request-context';
import { ReserveTable, type ReserveDocument, type ReserveRow } from './reserve-table';

/**
 * E4 „Zurückgelegtes Geld“ (F8b Task 6b, Designer-README 4d): Kopfsatz,
 * Höchstbetrag der freien Rücklage als Näherung mit „davon genutzt“ und
 * Herleitung, Tabelle, Vorgang-Dialog, Stammsatz (`finance.setup`).
 */
export default async function ReservesPage() {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
  const t = await getTranslations('finance.reserves');
  const tLimit = await getTranslations('finance.limitProgress');

  const today = isoNow(deps.clock).slice(0, 10);
  const canSetup = hasPermission(ctx, 'finance.setup');
  // Stillgelegtes sieht, wer es wieder aktivieren kann (Befund 40).
  const reservesRes = await listReserves(deps, ctx, { includeInactive: canSetup });
  const purposesRes = await listPurposes(deps, ctx, {});
  const yearsRes = await listFiscalYears(deps, ctx);
  const purposes = purposesRes.ok ? purposesRes.value.map((p) => ({ id: p.id, name: p.name })) : [];
  const purposeName = new Map(purposes.map((p) => [p.id, p.name]));
  const years = yearsRes.ok ? yearsRes.value : [];
  const current = years.find((y) => y.startsOn <= today && today <= y.endsOn) ?? null;

  // Nummer, Betreff und Datum des Beschlusses nur, wenn die Akte sie dieser Person zeigt — sonst „hinterlegt“ (Muster E1, D5).
  const document = async (documentId: string | null): Promise<ReserveDocument | null> => {
    if (!documentId) return null;
    const record = await getDocumentRecord(deps, ctx, documentId);
    return record.ok ? { id: documentId, number: record.value.number ?? '', subject: record.value.subject, date: record.value.documentDate } : { id: documentId, hidden: true };
  };
  const rows: ReserveRow[] = await Promise.all(
    (reservesRes.ok ? reservesRes.value : []).map(async (r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      balanceCents: r.balanceCents,
      purposeId: r.purposeId,
      purposeText: r.purposeText,
      purposeLabel: (r.purposeId ? purposeName.get(r.purposeId) : null) ?? r.purposeText ?? null,
      resolution: await document(r.resolutionDocumentId),
      carryForwardCents: r.carryForwardCents,
      carryForwardDate: r.carryForwardDate,
      carryForwardDocument: await document(r.carryForwardDocumentId),
      isActive: r.isActive,
      isDissolved: r.isDissolved,
      updatedAt: r.updatedAt,
    })),
  );

  let cap: ReactNode = <p className="text-[13px] text-muted-ink">{t('cap.noYear')}</p>;
  if (current) {
    const capRes = await freeReserveCap(deps, ctx, { fiscalYearId: current.id });
    if (capRes.ok) {
      const { capCents, usedCents, assetManagementSurplusCents, otherTimelyFundsCents, exceeded, overCents } = capRes.value;
      const warnAtPercent = (valueAt(deps.db, 'warnAtPercent', today) as number | null) ?? 80;
      const assetShare = (valueAt(deps.db, 'freeReserveAssetShare', current.endsOn) as number | null) ?? 0;
      const otherShare = (valueAt(deps.db, 'freeReserveOtherShare', current.endsOn) as number | null) ?? 0;
      const state = limitState({ valueCents: usedCents, limitCents: capCents, warnAtPercent, kind: 'limit' });
      cap = (
        <div className="rounded-lg border border-line bg-surface p-4" data-testid="reserve-cap">
          <LimitProgress
            coveredCents={usedCents}
            totalCents={capCents}
            label={t('cap.label', { year: current.designation, cap: formatEuro(capCents) })}
            state={state}
            stateLabel={state ? tLimit(`states.${state}`) : undefined}
            figure={t('cap.figure', { used: formatEuro(usedCents), cap: formatEuro(capCents) })}
            remainder={t('cap.derivation', { assetShare, asset: formatEuro(Math.max(0, assetManagementSurplusCents)), otherShare, other: formatEuro(otherTimelyFundsCents) })}
          />
          {/* Befund S: das Kennzeichen des Dienstes, mit dem Betrag darüber. */}
          {exceeded ? (
            <p className="mt-2 text-[13px] font-semibold text-error" data-testid="reserve-cap-over">
              {t('cap.over', { over: formatEuro(overCents) })}
            </p>
          ) : null}
        </div>
      );
    }
  }

  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('intro')} />}>
      <div className="space-y-4">
        {cap}
        <ReserveTable
          rows={rows}
          purposes={purposes}
          fiscalYears={years.map((y) => ({ id: y.id, designation: y.designation }))}
          defaultFiscalYearId={current?.id ?? null}
          today={today}
          canWrite={hasPermission(ctx, 'finance.entriesWrite')}
          canSetup={canSetup}
        />
      </div>
    </Page>
  );
}

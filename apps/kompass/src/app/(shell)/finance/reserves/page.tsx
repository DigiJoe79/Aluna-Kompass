import { hasPermission, isoNow } from '@kompass/core';
import { getDocumentRecord } from '@kompass/module-dms';
import { freeReserveCapOverview, listFiscalYears, listPurposes, listReserves, valueAt, type FreeReserveCapYearView } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LimitProgress, limitState } from '@/components/finance/limit-progress';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { formatEuro } from '@/lib/finance/amount';
import { requireSession } from '@/lib/request-context';
import { ReserveTable, type ReserveDocument, type ReserveRow } from './reserve-table';

/**
 * E4 „Zurückgelegtes Geld“ (F8b Task 6b, Designer-README 4d): Kopfsatz,
 * Höchstbetrag der freien Rücklage als Näherung mit „davon genutzt“ und
 * Herleitung, Tabelle, Vorgang-Dialog, Stammsatz (`finance.setup`).
 * Befund 4 (0.2.7): je Jahr eine Karte — das offene Vorjahr „vorläufig“ und
 * das laufende Jahr; dieselbe Regel schlägt das Jahr im Vorgang-Dialog vor.
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
  const capRes = await freeReserveCapOverview(deps, ctx, {});
  const purposes = purposesRes.ok ? purposesRes.value.map((p) => ({ id: p.id, name: p.name })) : [];
  const purposeName = new Map(purposes.map((p) => [p.id, p.name]));
  const years = yearsRes.ok ? yearsRes.value : [];
  const capYears = capRes.ok ? capRes.value.years : [];
  const defaultFiscalYearId = capRes.ok ? capRes.value.defaultFiscalYearId : null;
  const warnAtPercent = (valueAt(deps.db, 'warnAtPercent', today) as number | null) ?? 80;

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

  const capCard = (y: FreeReserveCapYearView): ReactNode => {
    const assetShare = (valueAt(deps.db, 'freeReserveAssetShare', y.endsOn) as number | null) ?? 0;
    const otherShare = (valueAt(deps.db, 'freeReserveOtherShare', y.endsOn) as number | null) ?? 0;
    const derivation = t('cap.derivation', { assetShare, asset: formatEuro(Math.max(0, y.assetManagementSurplusCents)), otherShare, other: formatEuro(y.otherTimelyFundsCents) });
    // Noch keine Einnahmen im Jahr und nichts zugeführt: ein Zustandswort statt eines leeren Balkens. Mit Zuführung
    // bleibt es beim Balken und der Zeile „über dem Höchstbetrag“ (`limitState` kennt bei Grenze 0 keinen Zustand).
    const noCapYet = y.capCents <= 0 && y.usedCents === 0;
    const state = limitState({ valueCents: y.usedCents, limitCents: y.capCents, warnAtPercent, kind: 'limit' });
    return (
      <div key={y.fiscalYearId} className="rounded-lg border border-line bg-surface p-4" data-testid="reserve-cap" data-fiscal-year={y.designation} data-provisional={y.provisional ? 'true' : undefined}>
        {noCapYet ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] text-ink-2">{t(y.provisional ? 'cap.headingProvisional' : 'cap.heading', { year: y.designation })}</p>
              <StatusBadge tone="neutral">{t('cap.noCapYet')}</StatusBadge>
            </div>
            <p className="text-[12px] text-muted-ink">{derivation}</p>
          </div>
        ) : (
          <LimitProgress
            coveredCents={y.usedCents}
            totalCents={y.capCents}
            label={t(y.provisional ? 'cap.labelProvisional' : 'cap.label', { year: y.designation, cap: formatEuro(y.capCents) })}
            state={state}
            stateLabel={state ? tLimit(`states.${state}`) : undefined}
            figure={t('cap.figure', { used: formatEuro(y.usedCents), cap: formatEuro(y.capCents) })}
            remainder={derivation}
          />
        )}
        {/* Befund S: das Kennzeichen des Dienstes, mit dem Betrag darüber. */}
        {y.exceeded ? (
          <p className="mt-2 text-[13px] font-semibold text-error" data-testid="reserve-cap-over">
            {t('cap.over', { over: formatEuro(y.overCents) })}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('intro')} />}>
      <div className="space-y-4">
        {capYears.length === 0 ? <p className="text-[13px] text-muted-ink">{t('cap.noYear')}</p> : capYears.map(capCard)}
        <ReserveTable
          rows={rows}
          purposes={purposes}
          fiscalYears={years.map((y) => ({ id: y.id, designation: y.designation }))}
          defaultFiscalYearId={defaultFiscalYearId}
          today={today}
          canWrite={hasPermission(ctx, 'finance.entriesWrite')}
          canSetup={canSetup}
        />
      </div>
    </Page>
  );
}

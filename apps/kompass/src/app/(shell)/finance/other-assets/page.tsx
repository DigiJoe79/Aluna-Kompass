import { hasPermission, todayIn } from '@kompass/core';
import { getDocumentRecord } from '@kompass/module-dms';
import { listOtherAssets, type OtherAssetView } from '@kompass/module-finance';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { requireSession } from '@/lib/request-context';
import { OtherAssetList, type OtherAssetRow } from './other-asset-list';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sonstiges Vermögen (Designer Runde 2, 11d–11h): Werte, die nicht auf einem Konto stehen — Sachwerte, Inventar,
 * Darlehen, Kautionen. „Stand am“ (Vorgabe heute in Vereinszeit, `?date=`) zeigt genau, was ein Bericht zu diesem
 * Stichtag zeigt. Lesen mit `finance.overview` oder `finance.read`, pflegen mit `finance.entriesWrite`.
 */
export default async function OtherAssetsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read') && !hasPermission(ctx, 'finance.overview')) return <Page width="standard"><ForbiddenCard permission="finance.overview" /></Page>;
  const today = todayIn(deps);
  const query = await searchParams;
  const date = query.date && ISO_DAY.test(query.date) ? query.date : today;

  const [atDate, ended, all] = await Promise.all([listOtherAssets(deps, ctx, { date }), listOtherAssets(deps, ctx, { ended: true }), listOtherAssets(deps, ctx, {})]);
  const shown = atDate.ok ? atDate.value.items : [];
  const shownIds = new Set(shown.map((r) => r.id));
  // Nummer und Betreff des Belegs nur, wenn die Akte ihn dieser Person zeigt (Muster „Zurückgelegtes Geld“).
  const toRow = async (r: OtherAssetView): Promise<OtherAssetRow> => {
    const record = r.documentId ? await getDocumentRecord(deps, ctx, r.documentId) : null;
    return { ...r, documentNumber: record?.ok ? record.value.number : null, documentSubject: record?.ok ? record.value.subject : null };
  };

  return (
    <Page width="standard">
      <OtherAssetList
        rows={await Promise.all(shown.map(toRow))}
        // Beendet und am Stichtag nicht mehr gültig: unter der Tabelle, zugeklappt.
        ended={await Promise.all((ended.ok ? ended.value.items : []).filter((r) => !shownIds.has(r.id)).map(toRow))}
        date={date}
        today={today}
        canWrite={hasPermission(ctx, 'finance.entriesWrite')}
        hasAny={all.ok && all.value.items.length > 0}
      />
    </Page>
  );
}

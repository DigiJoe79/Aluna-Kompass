import { hasPermission, isoNow, listUserNamesWithPermission } from '@kompass/core';
import { purposeOverview } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { TransferForm } from './transfer-form';

/**
 * E5 „Zweck ändern (Umwidmung)“ als Formular (Entscheidung 6, 2026-09-28):
 * derselbe Aufbau wie D1 — eine Spalte auf 390 px, Dokument Pflicht über die
 * Ablagefläche, klebende Fußleiste mit „Zur Freigabe geben“. Freigegeben wird
 * in der gemeinsamen Detailansicht der Freigaben (3h).
 */
export default async function PurposeTransferPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { deps, ctx, user } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;
  if (!hasPermission(ctx, 'finance.entriesWrite')) return <ForbiddenCard permission="finance.entriesWrite" />;
  const t = await getTranslations('finance.purposes.transferDialog');
  const tPurposes = await getTranslations('finance.purposes');

  const overview = await purposeOverview(deps, ctx);
  const purposes = (overview.ok ? overview.value : []).map((p) => ({ id: p.id, name: p.name, open: p.state === 'open', balanceCents: p.balanceCents }));
  const query = await searchParams;
  const defaultFromId = purposes.some((p) => p.id === query.from) ? query.from : undefined;
  // „Freigeben kann: …“ (Designer-README 4e) — nie die anlegende Person selbst.
  const approverNames = listUserNamesWithPermission(deps, 'finance.approve').filter((name) => name !== user.name);

  return (
    <div className="max-w-[640px] space-y-4">
      <PageHeader title={t('title')} description={t('intro')} back={{ href: '/finance/purposes', label: tPurposes('title') }} />
      <TransferForm purposes={purposes} defaultFromId={defaultFromId} today={isoNow(deps.clock).slice(0, 10)} approverNames={approverNames} />
    </div>
  );
}

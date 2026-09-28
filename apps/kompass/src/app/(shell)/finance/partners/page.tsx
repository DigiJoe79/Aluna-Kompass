import { hasPermission } from '@kompass/core';
import { listPartners } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { PartnerList } from './partner-list';

/**
 * E1 „Partner“ (F7 Task 6b, Spec 8.1, Design-Nachtrag Phase 4): die Angaben
 * zum Partner je Kontakt, eine Tabellenzeile je Partner mit Status, üblicher
 * Art, offenen Nachweisen und letztem Zahlungstag. Nur
 * `finance.read` sieht die Liste; anlegen und ändern verlangt
 * `finance.entriesWrite` (die Seite selbst blendet den Knopf dann aus, ohne
 * eine zweite Seite zu brauchen).
 */
export default async function PartnersPage() {
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'finance.read')) return <ForbiddenCard permission="finance.read" />;
  const t = await getTranslations('finance.partners.list');
  const canWrite = hasPermission(ctx, 'finance.entriesWrite');

  const result = await listPartners(deps, ctx, { includeInactive: true });
  const partners = result.ok ? result.value : [];

  return (
    <div className="max-w-[960px]">
      <PageHeader title={t('title')} description={t('intro')} />
      {partners.length === 0 && !canWrite ? (
        <EmptyState title={t('emptyTitle')} text={t('emptyText')} />
      ) : (
        <PartnerList partners={partners.map((p) => ({ id: p.id, contactId: p.contactId, contactName: p.contactName, status: p.status, usualBasis: p.usualBasis, isActive: p.isActive, openProofCount: p.openProofCount, overdueProofCount: p.overdueProofCount, lastPaidOn: p.lastPaidOn }))} canWrite={canWrite} />
      )}
    </div>
  );
}

import { hasPermission, isModuleEnabled, readSetting, type CallContext, type Deps } from '@kompass/core';
import { listDocuments } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { formatDate, type DateFormatMode } from '@/lib/dates';

/**
 * Die Beziehungsakte von der anderen Seite. Lebt in der App-Schicht, weil
 * Kontakte, Tiere und Projekte nicht von der Akte abhängen dürfen — die App
 * kennt alle Module, wie sie heute schon Bezüge zu Namen auflöst. Ist die
 * Akte aus oder das Recht fehlt, gibt es den Kasten nicht.
 */
export async function RelatedDocuments({
  deps,
  ctx,
  entityType,
  entityId,
}: {
  deps: Deps;
  ctx: CallContext;
  entityType: 'contact' | 'animal' | 'project';
  entityId: string;
}) {
  if (!isModuleEnabled(deps, 'dms') || !hasPermission(ctx, 'dms.view')) return null;
  const t = await getTranslations('dms.related');
  const res = await listDocuments(deps, ctx, { linkedTo: { entityType, entityId }, limit: 50 });
  if (!res.ok) return null;
  const canCreate = hasPermission(ctx, 'dms.create');
  const dateFormat = readSetting<DateFormatMode>(deps, 'ui.dateFormat');

  const receiveHref =
    entityType === 'contact' ? `/dms/receive?sender=${entityId}` : `/dms/receive?about=${entityType}:${entityId}`;

  return (
    <section data-testid="related-documents" className="rounded-md border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">{t('title')}</h2>
        {canCreate ? (
          <div className="flex gap-2">
            {entityType === 'contact' ? (
              <Link href={`/dms/new?recipient=${entityId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('writeLetter')}
              </Link>
            ) : null}
            <Link href={receiveHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t('receivePost')}
            </Link>
          </div>
        ) : null}
      </div>
      {res.value.documents.length === 0 ? (
        <p className="text-[13px] text-muted-ink">{t('none')}</p>
      ) : (
        <ul className="divide-y divide-line-2 text-[13px]">
          {res.value.documents.map((doc) => {
            const role = doc.links.find((l) => l.entityType === entityType && l.entityId === entityId)?.role;
            return (
              <li key={doc.id} className="flex items-center gap-3 py-2">
                <Link href={`/dms/${doc.id}`} className="font-mono font-semibold underline underline-offset-2 hover:text-link">
                  {doc.number ?? t('draft')}
                </Link>
                <Link href={`/dms/${doc.id}`} className="min-w-0 flex-1 truncate text-ink hover:underline">
                  {doc.subject}
                </Link>
                <span className="font-mono text-[12px] text-ink-2">{formatDate(doc.documentDate, dateFormat)}</span>
                {role ? <StatusBadge tone="neutral">{t(`roles.${role}`)}</StatusBadge> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

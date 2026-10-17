import { hasPermission, isModuleEnabled, type CallContext, type Deps } from '@kompass/core';
import { listDocuments, requireDmsGate } from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { dateFormatOf } from '@/lib/date-format';

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
  if (!isModuleEnabled(deps, 'dms') || requireDmsGate(deps, ctx)) return null;
  const t = await getTranslations('dms.related');
  const res = await listDocuments(deps, ctx, { linkedTo: { entityType, entityId }, limit: 50 });
  if (!res.ok) return null;
  const canCreate = hasPermission(ctx, 'dms.create');
  const fmt = dateFormatOf(deps);

  const receiveHref =
    entityType === 'contact' ? `/dms/receive?sender=${entityId}` : `/dms/receive?about=${entityType}:${entityId}`;

  // Zwei Aktionen passen am Telefon nicht neben den Titel: `Section` bricht sie um wie der Seitenkopf.
  const actions = canCreate ? (
    <>
      {entityType === 'contact' ? (
        <Link href={`/dms/new?recipient=${entityId}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('writeLetter')}
        </Link>
      ) : null}
      <Link href={receiveHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        {t('receivePost')}
      </Link>
    </>
  ) : undefined;

  return (
    <div data-testid="related-documents" className="rounded-md border border-line bg-surface p-5">
      <Section title={t('title')} actions={actions}>
      {res.value.documents.length === 0 ? (
        <p className="text-meta text-muted-ink">{t('none')}</p>
      ) : (
        <ul className="divide-y divide-line-2 text-meta">
          {res.value.documents.map((doc) => {
            const role = doc.links.find((l) => l.entityType === entityType && l.entityId === entityId)?.role;
            return (
              // Am Telefon steht der Betreff in einer eigenen Zeile, statt auf „Anme…“ gekürzt zu werden (04 B18).
              // Kein Layout-Test für diese Einzelstelle (AGENTS.md).
              <li key={doc.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Link href={`/dms/${doc.id}`} className="font-mono underline underline-offset-2 hover:text-link">
                  {doc.number ?? t('draft')}
                </Link>
                <Link href={`/dms/${doc.id}`} className="min-w-0 flex-1 truncate text-ink hover:underline max-sm:order-last max-sm:basis-full max-sm:whitespace-normal">
                  {doc.subject}
                </Link>
                <span className="tabular-nums text-hint text-ink-2">{fmt.date(doc.documentDate)}</span>
                {role ? <StatusBadge tone="neutral">{t(`roles.${role}`)}</StatusBadge> : null}
              </li>
            );
          })}
        </ul>
      )}
      </Section>
    </div>
  );
}

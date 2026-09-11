import type { AuditEntry } from '@kompass/core';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { cn } from '@/lib/utils';

export async function AuditTable({
  entries,
  selectedId,
  query,
}: {
  entries: AuditEntry[];
  selectedId: string | null;
  query: string;
}) {
  const t = await getTranslations('audit');
  const format = await getFormatter();
  const tone = { ui: 'info', mcp: 'accent', system: 'neutral' } as const;

  // Spaltenköpfe über einer leeren Fläche sagen nicht, ob nichts passiert ist
  // oder der Filter zu eng steht.
  if (entries.length === 0) {
    return <EmptyState title={t('empty.title')} text={t('empty.text')} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
          <tr className="h-9">
            <th className="px-4">{t('columns.time')}</th>
            <th className="px-4">{t('columns.user')}</th>
            <th className="px-4">{t('columns.channel')}</th>
            <th className="px-4">{t('columns.action')}</th>
            <th className="px-4">{t('columns.entity')}</th>
            <th className="px-4">{t('columns.summary')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr
              key={e.id}
              className={cn(
                'group relative h-[var(--row-h)] border-b border-line-2 cursor-pointer hover:bg-row-hover',
                i % 2 === 1 && 'bg-zebra',
                e.id === selectedId && 'bg-selected'
              )}
            >
              <td className="px-4 font-mono text-[12px]">
                <Link
                  href={`?${query}${query ? '&' : ''}entry=${e.id}`}
                  className="block after:absolute after:inset-0"
                >
                  {format.dateTime(new Date(e.occurredAt), { dateStyle: 'short', timeStyle: 'medium' })}
                </Link>
              </td>
              <td className="px-4 text-ink-2">{e.userName ?? '—'}</td>
              <td className="px-4">
                <StatusBadge tone={tone[e.channel]}>{t(`filters.channels.${e.channel}`)}</StatusBadge>
              </td>
              <td className="px-4 font-mono text-[12px]">{e.action}</td>
              <td className="px-4 text-ink-2">
                {e.entityType}
                {e.entityId ? ` · ${e.entityId}` : ''}
              </td>
              <td className="max-w-[320px] truncate px-4 text-ink-2">{e.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

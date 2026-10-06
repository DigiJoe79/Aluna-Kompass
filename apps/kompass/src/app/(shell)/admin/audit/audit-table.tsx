import type { AuditEntry } from '@kompass/core';
import { getFormatter, getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { AuditEntityLabel } from '@/lib/audit-entities';

export async function AuditTable({
  entries,
  selectedId,
  query,
  labels = {},
}: {
  entries: AuditEntry[];
  selectedId: string | null;
  query: string;
  /** Live aufgelöste Namen je Eintrag — das Protokoll selbst trägt bei Personendaten nur die ID. */
  labels?: Record<string, AuditEntityLabel>;
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
    <Table className="text-[14px]">
      <TableHeader>
        <TableRow>
          <TableHead>{t('columns.time')}</TableHead>
          <TableHead>{t('columns.user')}</TableHead>
          <TableHead>{t('columns.channel')}</TableHead>
          <TableHead>{t('columns.action')}</TableHead>
          <TableHead>{t('columns.entity')}</TableHead>
          <TableHead>{t('columns.summary')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e) => (
          <TableRow key={e.id} data-state={e.id === selectedId ? 'selected' : undefined}>
            <TableCell className="font-mono text-[12px]">
              <RowLink href={`?${query}${query ? '&' : ''}entry=${e.id}`}>
                {format.dateTime(new Date(e.occurredAt), { dateStyle: 'short', timeStyle: 'medium' })}
              </RowLink>
            </TableCell>
            <TableCell className="text-ink-2">{e.userName ?? '—'}</TableCell>
            <TableCell>
              <StatusBadge tone={tone[e.channel]}>{t(`filters.channels.${e.channel}`)}</StatusBadge>
            </TableCell>
            <TableCell className="font-mono text-[12px]">{e.action}</TableCell>
            {/* Objekt und Zusammenfassung brechen um, Kennungen auch mitten im Wort (wie
                in der Akte): Einzeilig lief die Tabelle bei 1440 px seitlich über, und
                `max-w` mit `truncate` greift an einer Tabellenzelle nicht
                (release-0.2.7.md, Befund 14). */}
            <TableCell className="whitespace-normal wrap-anywhere text-ink-2">
              {e.entityType}
              {labels[e.id]?.state === 'ok'
                ? ` · ${(labels[e.id] as { label: string }).label}`
                : labels[e.id]?.state === 'missing'
                  ? ` · ${t('deletedRecord', { type: e.entityType })}`
                  : e.entityId
                    ? ` · ${e.entityId}`
                    : ''}
            </TableCell>
            <TableCell className="whitespace-normal text-ink-2">{e.summary}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

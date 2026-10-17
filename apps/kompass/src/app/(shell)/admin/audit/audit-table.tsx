import type { AuditEntry } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { isNormalInList, StatusBadge, statusTone } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { auditActionLabel } from '@/lib/audit-actions';
import { auditObject, type AuditEntityLabel } from '@/lib/audit-entities';
import { AuditObjectLabel } from './audit-object';
import type { DateFormatter } from '@/lib/date-format';
import { Empty } from '@/components/empty-value';

export async function AuditTable({
  entries,
  selectedId,
  query,
  labels = {},
  fmt,
  sentences = {},
  filtered = null,
}: {
  entries: AuditEntry[];
  selectedId: string | null;
  query: string;
  /** Live aufgelöste Namen je Eintrag (`auditEntityLabels`) — das Protokoll selbst trägt bei Personendaten nur die ID. */
  labels?: Record<string, AuditEntityLabel>;
  /** Protokoll mit Sekunden (MUSTER § Datum). */
  fmt: DateFormatter;
  /** Satz je Eintrag aus `auditSentences`; `null` → Klartext der Aktion (Spec Protokoll § 4). */
  sentences?: Record<string, string | null>;
  /** Gesetzte Filter: gefilterter Leerzustand; `peopleHint`, wenn eine Suche ohne Nutzer-Filter nichts fand. */
  filtered?: { resetHref: string; peopleHint: boolean } | null;
}) {
  const t = await getTranslations('audit');

  // Spaltenköpfe über einer leeren Fläche sagen nicht, ob nichts passiert ist
  // oder der Filter zu eng steht.
  if (entries.length === 0) {
    // Die Suche läuft über das Gespeicherte, nicht über Sätze: Personen stehen nur als ID darin (Designer 2026-10-09).
    if (filtered) return <EmptyState filtered={{ noun: t('emptyFilteredNoun'), resetHref: filtered.resetHref, text: filtered.peopleHint ? t('emptyPeopleHint') : undefined }} />;
    return <EmptyState title={t('empty.title')} text={t('empty.text')} />;
  }

  return (
    <Table className="text-body">
      <TableHeader>
        <TableRow>
          <TableHead col="meta">{t('columns.time')}</TableHead>
          <TableHead col="meta">{t('columns.user')}</TableHead>
          <TableHead col="status">{t('columns.channel')}</TableHead>
          <TableHead col="title">{t('columns.action')}</TableHead>
          <TableHead col="meta">{t('columns.entity')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e) => (
          <TableRow key={e.id} data-state={e.id === selectedId ? 'selected' : undefined}>
            <TableCell col="meta" className="tabular-nums text-hint">
              <RowLink href={`?${query}${query ? '&' : ''}entry=${e.id}`}>
                {fmt.dateTime(e.occurredAt, { seconds: true })}
              </RowLink>
            </TableCell>
            <TableCell col="meta" className="text-ink-2">{e.userName ?? <Empty />}</TableCell>
            <TableCell col="status">
              {isNormalInList('auditChannel', e.channel) ? null : (
                <StatusBadge tone={statusTone('auditChannel', e.channel)}>{t(`filters.channels.${e.channel}`)}</StatusBadge>
              )}
            </TableCell>
            <TableCell col="title" className="whitespace-normal">{sentences[e.id] ?? auditActionLabel(t, e.action)}</TableCell>
            {/* Objekt bricht um, Kennungen auch mitten im Wort (wie
                in der Akte): Einzeilig lief die Tabelle bei 1440 px seitlich über, und
                `max-w` mit `truncate` greift an einer Tabellenzelle nicht
                (release-0.2.7.md, Befund 14). */}
            {/* Typ in Worten und Name, ohne Namen nur der Typ — nie die ID, die steht im Detail (Joe 2026-10-09). */}
            <TableCell col="meta" className="whitespace-normal wrap-anywhere text-ink-2">
              <AuditObjectLabel object={auditObject(t, e, labels[e.id])} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { PageHeader } from '@/components/page-header';
import type { HeaderAction } from '@/components/record-actions';
import type { AuditHead } from '@/lib/finance/audit-overview';
import { RemarkDialog } from './remark-dialog';
import type { RemarkWriterProps } from './remark-writer';

/**
 * Kopf der Kassenprüfung (Board 4a, 12c): Der Satz unter dem Titel sagt den Stand des Jahres, ohne Kasten und ohne
 * Farbe. In der Prüferansicht steht darunter, mit wem man prüft. „Vermerk zum Jahr …“ kommt als Nebenaktion (`more`).
 */
export function AuditHeader({
  designation,
  head,
  auditorView,
  canManage,
  yearRemark,
}: {
  designation: string;
  head: AuditHead;
  /** Prüferansicht: die anderen Prüfer des Jahres. */
  auditorView: { coAuditors: { name: string; paper: boolean }[] } | null;
  /** Darf Prüfer eintragen (Satz „noch kein Prüfer“ ohne Verweis auf die Schatzmeisterin). */
  canManage: boolean;
  /** Prüferansicht: „Vermerk zum Jahr …“ (Board 4a) als Nebenaktion im Kopf. */
  yearRemark?: RemarkWriterProps | null;
}) {
  const t = useTranslations('finance.audit');
  const tc = useTranslations('finance.closing.auditReport');
  const fmt = useDateFormat();
  const [writing, setWriting] = useState(false);
  const more: HeaderAction[] = yearRemark ? [{ key: 'remark', label: t('remarks.writeYear'), onSelect: () => setWriting(true), testId: 'audit-year-remark' }] : [];

  const sentence = (() => {
    switch (head.kind) {
      case 'yearOpen':
        return t('head.yearOpen');
      case 'noAuditors':
        return canManage ? t('head.noAuditors', { year: designation }) : t('head.noAuditorsReader', { year: designation });
      case 'done':
        // Nach einer bestätigten Nachprüfung nennt der Kopf auch sie (Designer Runde 8, 346).
        return head.confirmedAt ? t('head.doneConfirmed', { date: fmt.date(head.filedAt), confirmed: fmt.date(head.confirmedAt) }) : t('head.done', { date: fmt.date(head.filedAt) });
      case 'followUp':
        // Ohne geänderte Buchung derselbe Befund wie in Schritt 10 des Jahresabschlusses (260 Telefon).
        if (head.changed === 0) {
          const at = head.filedAt ?? head.since;
          return at ? tc('followUp.unchanged', { date: fmt.date(at) }) : tc('followUp.unchangedNoDate');
        }
        return t('head.followUp', { date: fmt.date(head.since), count: head.changed });
      case 'running': {
        const parts = [
          head.since ? t('head.baseline', { date: fmt.date(head.since) }) : null,
          t('head.reviewed', { reviewed: head.reviewed, total: head.total }),
          head.remarksOpen > 0 ? t('head.remarksOpen', { count: head.remarksOpen }) : null,
          head.report === 'partial' ? t('head.report.partial', { filed: head.scans.filed, expected: head.scans.expected }) : t(`head.report.${head.report}`),
        ].filter((p): p is string => Boolean(p));
        return `${parts.join(' · ')}.`;
      }
    }
  })();

  const others = auditorView?.coAuditors.map((a) => (a.paper ? t('head.paperName', { name: a.name }) : a.name)) ?? [];
  const withWhom = auditorView ? (others.length === 0 ? t('head.alone') : t('head.withOthers', { names: joinNames(others, t('head.and')) })) : null;

  // Die Beschreibung steht im `<p>` des Kopfs: Teile als `span` (kein `p` im `p`).
  const description = (
    <>
      <span data-testid="audit-head">{sentence}</span>
      {withWhom ? (
        <span className="mt-1 block text-meta text-muted-ink" data-testid="audit-with">
          {withWhom}
        </span>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader title={t('title', { year: designation })} description={description} more={more} />
      {yearRemark ? <RemarkDialog open={writing} onOpenChange={setWriting} {...yearRemark} /> : null}
    </>
  );
}

/** „A“, „A und B“, „A, B und C“. */
export function joinNames(names: readonly string[], and: string): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`;
}

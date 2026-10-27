'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { Notice } from '@/components/notice';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toastRefusal } from '@/lib/feedback';
import { completeFollowUpAction, reopenFollowUpAction } from './actions';
import { FollowUpDialog, type FollowUpPreset } from './follow-up-dialog';

export interface FollowUpRow {
  id: string;
  dueAt: string;
  title: string;
  titleHidden: boolean;
  doneAt: string | null;
  target: { label: string; href?: string | null } | null;
}

/**
 * Abschnitt „Wiedervorlagen“ (Board 6a): Zeilen wie das Widget „Fällig“ — Kästchen, Datum, überfällig `warning`,
 * Bezug als Link; die Zeile ist kein Link. Erledigte bleiben 30 Tage gedämpft. Das Kästchen ist ein Wert in der Zeile,
 * eine Ablehnung geht deshalb an `toastRefusal` (kein Platz über dem Auslöser). Der Vorschlag „Jahresabschluss vor der
 * MV“ steht als Hinweis mit einem vorbelegten Dialog (Claude) — Kompass legt nichts selbst an.
 */
export function FollowUpList({
  rows,
  canManage,
  years,
  defaultYearId,
  suggestion,
  today,
}: {
  rows: readonly FollowUpRow[];
  canManage: boolean;
  years: readonly { id: string; designation: string }[];
  defaultYearId: string | null;
  suggestion: { fiscalYearId: string; designation: string } | null;
  today: string;
}) {
  const t = useTranslations('finance.deadlines.followUps');
  const fmt = useDateFormat();
  const router = useRouter();
  const [dialog, setDialog] = useState<FollowUpPreset | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (row: FollowUpRow, done: boolean) => {
    setBusy(row.id);
    const result = await (done ? completeFollowUpAction(row.id) : reopenFollowUpAction(row.id));
    setBusy(null);
    if (result.status === 'error') toastRefusal(result);
    else router.refresh();
  };

  return (
    <Section
      title={t('title')}
      intro={t('intro')}
      actions={
        canManage ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setDialog({})} data-testid="follow-up-create">
            {t('create')}
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        {suggestion && canManage ? (
          <div data-testid="follow-up-suggestion">
            <Notice level="hint">
              <span className="flex flex-col items-start gap-2">
                {t('suggestion', { designation: suggestion.designation })}
                <Button type="button" variant="outline" size="sm" onClick={() => setDialog({ title: t('suggestionTitle', { designation: suggestion.designation }), fiscalYearId: suggestion.fiscalYearId })} data-testid="follow-up-suggestion-create">
                  {t('create')}
                </Button>
              </span>
            </Notice>
          </div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead col="select">
                <span className="sr-only">{t('columns.done')}</span>
              </TableHead>
              <TableHead col="meta">{t('columns.date')}</TableHead>
              <TableHead col="title">{t('columns.title')}</TableHead>
              <TableHead col="status">
                <span className="sr-only">{t('overdue')}</span>
              </TableHead>
              <TableHead col="meta" wrap>
                {t('columns.subject')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableEmpty colSpan={5}>{t('empty')}</TableEmpty> : null}
            {rows.map((row) => {
              const done = row.doneAt !== null;
              const title = row.titleHidden ? t('hidden') : row.title;
              return (
                <TableRow key={row.id} muted={done ? t('done') : undefined} data-testid="follow-up-row" data-done={done}>
                  <TableCell col="select">
                    <Checkbox checked={done} disabled={!canManage || busy === row.id} onCheckedChange={(v) => void toggle(row, v === true)} aria-label={t('check', { title })} data-testid="follow-up-check" />
                  </TableCell>
                  <TableCell col="meta">{fmt.date(row.dueAt)}</TableCell>
                  <TableCell col="title">{title}</TableCell>
                  <TableCell col="status">{!done && row.dueAt < today ? <StatusBadge tone="warning" dot>{t('overdue')}</StatusBadge> : null}</TableCell>
                  <TableCell col="meta" wrap>
                    {row.target?.href ? (
                      <Link href={row.target.href} className="text-link underline-offset-2 hover:underline">
                        {row.target.label}
                      </Link>
                    ) : (
                      (row.target?.label ?? null)
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {dialog ? <FollowUpDialog open onOpenChange={(o) => (o ? undefined : setDialog(null))} years={years} defaultYearId={defaultYearId} preset={dialog} /> : null}
    </Section>
  );
}

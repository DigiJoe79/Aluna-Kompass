'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ruleFormFromRule, type RuleFormState, type SavedRule } from '@/lib/finance/work-dialogs';
import { deleteImportRuleAction } from '../actions';
import { RuleDialog, type RuleDialogOptions } from '../rule-dialog';
import { RowMenu } from '@/components/row-menu';

export interface RuleRow {
  rule: SavedRule;
  contactName: string | null;
  /** Die Bedingung als Sätze — der Server setzt sie aus `ruleConditionParts` zusammen. */
  conditionTexts: string[];
  categoryName: string;
  categoryInactive: boolean;
  /** Das Kennzeichen der Regel gilt nicht mehr — derselbe Satz wie am Vorschlag (Befund 40, Frage 3), sonst `null`. */
  taxCodeHint: string | null;
  hitCount: number;
}

/** Die Regeln in ihrer Reihenfolge (die erste treffende gewinnt), mit Bearbeiten und Löschen. */
export function RulesTable({ rows, canWrite, options }: { rows: RuleRow[]; canWrite: boolean; options: RuleDialogOptions }) {
  const t = useTranslations('finance.work.pages.rules');
  const tMuted = useTranslations('common.muted');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [editing, setEditing] = useState<RuleFormState | null>(null);
  const [deleting, setDeleting] = useState<RuleRow | null>(null);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead col="title">{t('name')}</TableHead>
            <TableHead col="meta">{t('condition')}</TableHead>
            <TableHead col="meta">{t('result')}</TableHead>
            <TableHead col="status">{t('state')}</TableHead>
            <TableHead col="meta" className="text-right">{t('hits')}</TableHead>
            <TableHead col="actions" className="w-11"><span className="sr-only">{tCommon('rowActionsColumn')}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            // Ja/Nein-Liste (Joe 11.8): inaktiv ist die gedämpfte Zeile mit Marke hinter dem Namen, keine Statusspalte.
            <TableRow key={row.rule.id} className="align-top" muted={row.rule.isActive ? undefined : tMuted('deactivated')}>
              <TableCell col="title" className="py-2.5 text-ink">
                {canWrite ? (
                  <RowButton aria-haspopup="dialog" onClick={() => setEditing(ruleFormFromRule(row.rule, row.contactName))}>{row.rule.name}</RowButton>
                ) : (
                  row.rule.name
                )}
              </TableCell>
              <TableCell col="meta" className="py-2.5 text-ink-2">{row.conditionTexts.join(' · ')}</TableCell>
              <TableCell col="meta" className="py-2.5 text-ink-2">
                {row.categoryName}
                {row.taxCodeHint ? (
                  <p className="text-hint text-muted-ink" data-testid="rule-tax-code-hint">
                    {row.taxCodeHint}
                  </p>
                ) : null}
              </TableCell>
              {/* Runde 3, 072: Die Marke steht im Zustand, nicht im „Dann“; ohne Marke fällt die Spalte weg (Joe 11.8). */}
              <TableCell col="status" className="py-2.5">
                {row.categoryInactive ? <StatusBadge tone="error">{t('categoryInactive')}</StatusBadge> : null}
              </TableCell>
              <TableCell col="meta" data-testid="rule-hits" className="py-2.5 text-right tabular-nums">
                {row.hitCount}
              </TableCell>
              <TableCell col="actions" className="py-2.5 text-right">
                {canWrite ? (
                  <RowMenu
                    name={row.rule.name}
                    items={[
                      { key: 'edit', label: t('edit'), onSelect: () => setEditing(ruleFormFromRule(row.rule, row.contactName)) },
                      { key: 'delete', label: t('delete'), kind: 'delete', onSelect: () => setDeleting(row) },
                    ]}
                  />
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {editing ? <RuleDialog open onOpenChange={(open) => !open && setEditing(null)} initial={editing} mode="edit" options={options} onSaved={() => router.refresh()} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('deleteTitle')}
        description={t('deleteText')}
        confirmLabel={t('delete')}
        destructive
        action={async () => {
          const result = await deleteImportRuleAction(deleting!.rule.id);
          router.refresh();
          return result;
        }}
      />
    </div>
  );
}

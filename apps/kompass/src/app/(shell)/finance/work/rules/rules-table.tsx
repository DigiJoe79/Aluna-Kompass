'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ruleFormFromRule, type RuleFormState, type SavedRule } from '@/lib/finance/work-dialogs';
import { deleteImportRuleAction } from '../actions';
import { RuleDialog, type RuleDialogOptions } from '../rule-dialog';

export interface RuleRow {
  rule: SavedRule;
  contactName: string | null;
  /** Die Bedingung als Sätze — der Server setzt sie aus `ruleConditionParts` zusammen. */
  conditionTexts: string[];
  categoryName: string;
  categoryInactive: boolean;
  hitCount: number;
}

/** Die Regeln in ihrer Reihenfolge (die erste treffende gewinnt), mit Bearbeiten und Löschen. */
export function RulesTable({ rows, canWrite, options }: { rows: RuleRow[]; canWrite: boolean; options: RuleDialogOptions }) {
  const t = useTranslations('finance.work.pages.rules');
  const router = useRouter();
  const [editing, setEditing] = useState<RuleFormState | null>(null);
  const [deleting, setDeleting] = useState<RuleRow | null>(null);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="h-9">
            <TableHead className="px-4">{t('name')}</TableHead>
            <TableHead className="px-4">{t('condition')}</TableHead>
            <TableHead className="px-4">{t('result')}</TableHead>
            <TableHead className="px-4 text-right">{t('hits')}</TableHead>
            <TableHead className="px-4">{t('active')}</TableHead>
            <TableHead className="px-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.rule.id} className="border-b border-line-2 align-top">
              <TableCell className="px-4 py-2.5 font-medium text-ink">{row.rule.name}</TableCell>
              <TableCell className="px-4 py-2.5 text-ink-2">{row.conditionTexts.join(' · ')}</TableCell>
              <TableCell className="px-4 py-2.5 text-ink-2">
                <span className="flex flex-wrap items-center gap-2">
                  {row.categoryName}
                  {row.categoryInactive ? <StatusBadge tone="error">{t('categoryInactive')}</StatusBadge> : null}
                </span>
              </TableCell>
              <TableCell data-testid="rule-hits" className="px-4 py-2.5 text-right font-mono tabular-nums">
                {row.hitCount}
              </TableCell>
              <TableCell className="px-4 py-2.5">{row.rule.isActive ? t('yes') : t('no')}</TableCell>
              <TableCell className="px-4 py-2.5 text-right">
                {canWrite ? (
                  <span className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(ruleFormFromRule(row.rule, row.contactName))}>
                      {t('edit')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setDeleting(row)}>
                      {t('delete')}
                    </Button>
                  </span>
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

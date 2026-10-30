'use client';

import type { AgendaItemView } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { Notice } from '@/components/notice';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { Button, buttonVariants } from '@/components/ui/button';
import { RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Empty } from '@/components/empty-value';
import { toastRefusal } from '@/lib/feedback';
import { removeAgendaItemAction, reorderAgendaAction } from './actions';

/**
 * Tagesordnung (Board 2a, D2): Liste mit den Reihenfolge-Knöpfen am Rechner und ⋯ am Telefon, Bearbeiten im Dialog.
 * Ist die Einladung unterwegs, sagt ein Hinweis, dass Änderungen nachzureichen sind (Korrektur: `warn`, nicht Info).
 */
export function AgendaSection({
  meetingId,
  agenda,
  editable,
  invited,
  supplementHref,
  onCreate,
  onEdit,
}: {
  meetingId: string;
  agenda: AgendaItemView[];
  editable: boolean;
  invited: boolean;
  /** Nur Mitgliederversammlung: Serienlauf „Nachtrag“. */
  supplementHref: string | null;
  onCreate: () => void;
  onEdit: (item: AgendaItemView) => void;
}) {
  const t = useTranslations('governance.agenda');
  const tk = useTranslations('governance.agendaKinds');
  const [removing, setRemoving] = useState<AgendaItemView | null>(null);
  const [, start] = useTransition();
  const menu = useRef<HTMLButtonElement>(null);
  const ids = agenda.map((i) => i.id);
  const move = (index: number, delta: number) => {
    const next = [...ids];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved!);
    // Ablehnung als Toast wie an den Pfeilen (`ReorderButtons`, Erlaubnis R5): Im Menü ist kein Platz darüber.
    start(async () => toastRefusal(await reorderAgendaAction(meetingId, next)));
  };

  return (
    <Section title={t('title')} actions={editable ? <Button type="button" variant="outline" size="sm" onClick={onCreate} data-testid="agenda-create">{t('create')}</Button> : undefined}>
      <div className="flex flex-col gap-3">
        {invited && editable ? (
          <Notice level="warn" action={supplementHref ? <Link href={supplementHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>{t('supplement')}</Link> : undefined}>
            {t('invitedNotice')}
          </Notice>
        ) : null}
        {agenda.length === 0 ? (
          <p className="text-meta text-muted-ink">{t('empty')}</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead col="meta">{t('columns.number')}</TableHead>
                  <TableHead col="title">{t('columns.item')}</TableHead>
                  <TableHead col="meta">{t('columns.kind')}</TableHead>
                  <TableHead col="meta">{t('columns.attachments')}</TableHead>
                  {editable ? <TableHead col="actions"><span className="sr-only">{t('columns.actions')}</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {agenda.map((item, index) => (
                  <TableRow key={item.id} data-testid="agenda-row">
                    <TableCell col="meta">{item.position}</TableCell>
                    <TableCell col="title">
                      {editable ? (
                        <RowButton aria-haspopup="dialog" onClick={() => onEdit(item)}>{item.title}</RowButton>
                      ) : (
                        <span>{item.title}</span>
                      )}
                      {item.warnings.filter((w) => w === 'cashReportMissing' || w === 'auditReportMissing').map((w) => (
                        <span key={w} className="block text-meta text-warning">{t(`warnings.${w}`)}</span>
                      ))}
                    </TableCell>
                    <TableCell col="meta">{tk(item.kind)}</TableCell>
                    <TableCell col="meta">{item.attachmentDocumentIds.length > 0 ? item.attachmentDocumentIds.length : <Empty />}</TableCell>
                    {editable ? (
                      <TableCell col="actions">
                        <span className="inline-flex items-center gap-1">
                          <span className="max-sm:hidden">
                            <ReorderButtons ids={ids} index={index} action={(next) => reorderAgendaAction(meetingId, next)} />
                          </span>
                          <RowMenu
                            name={item.title}
                            triggerRef={menu}
                            items={[
                              { key: 'edit', label: t('menu.edit'), onSelect: () => onEdit(item) },
                              { key: 'up', label: t('menu.up'), onSelect: () => move(index, -1), hidden: index === 0 },
                              { key: 'down', label: t('menu.down'), onSelect: () => move(index, 1), hidden: index === agenda.length - 1 },
                              { key: 'remove', label: t('menu.remove'), kind: 'delete', onSelect: () => setRemoving(item) },
                            ]}
                          />
                        </span>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        title={t('removeDialog.title')}
        description={t('removeDialog.description')}
        confirmLabel={t('removeDialog.confirm')}
        finalFocus={menu}
        action={() => removeAgendaItemAction(meetingId, removing!.id)}
      />
    </Section>
  );
}

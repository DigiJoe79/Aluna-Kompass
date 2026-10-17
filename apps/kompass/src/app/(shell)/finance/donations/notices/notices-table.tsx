'use client';

import type { NoticeView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { useDateFormat } from '@/components/date-format-provider';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { isNormalInList, StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MutedMark, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { noticeActions, noticeStateDisplay } from '@/lib/finance/notices';
import { supersedeNoticeAction, voidNoticeAction } from './actions';
import { NoticeDialog, type SavedNotice } from './notice-dialog';
import { Empty } from '@/components/empty-value';
import { RowMenu } from '@/components/row-menu';

export type NoticeRow = Pick<NoticeView, 'id' | 'kind' | 'taxOffice' | 'taxNumber' | 'noticeDate' | 'exemptFrom' | 'assessmentPeriod' | 'purposesText' | 'purposesTextAccusative' | 'validUntil' | 'state' | 'supersededOn' | 'voidedAt' | 'documentId' | 'documentNumber' | 'supersededDocumentNumber'>;

/**
 * Die Reihe der Bescheide (C3), verdichtet auf sechs Spalten (K9-Befund 8),
 * damit sie auf einer `standard`-Seite nicht waagerecht scrollt: Bescheid (Art
 * in Alltagssprache, darunter Finanzamt · Steuernummer) · vom · gilt (Befreiung
 * ab – gültig bis, taggenau; darunter der Veranlagungszeitraum) · Dokument ·
 * Zustand. Handeln mit `finance.donationsIssue` über das Zeilenmenü wie bei den
 * Rücklagen (Backlog 36: drei Knöpfe untereinander machten die Zeile hoch):
 * Dokument nachreichen, aufgehoben oder ersetzt am …, irrtümlich erfasst.
 */
export function NoticesTable({ rows, canIssue, canPickDocument }: { rows: NoticeRow[]; canIssue: boolean; canPickDocument: boolean }) {
  const t = useTranslations('finance.donations.notices');
  const tk = useTranslations('finance.donations.noticeKind');
  const { date } = useDateFormat();
  const [supersede, setSupersede] = useState<NoticeRow | null>(null);
  const [voiding, setVoiding] = useState<NoticeRow | null>(null);
  const [attach, setAttach] = useState<SavedNotice | null>(null);

  return (
    <>
      <Table aria-label={t('tableLabel')}>
        <TableHeader>
          <TableRow>
            <TableHead col="title">{t('columns.notice')}</TableHead>
            <TableHead col="meta">{t('columns.noticeDate')}</TableHead>
            <TableHead col="meta">{t('columns.validity')}</TableHead>
            <TableHead col="meta">{t('columns.document')}</TableHead>
            <TableHead col="status">{t('columns.state')}</TableHead>
            {/* Der Kopf über ⋯ ist nur für Vorleser da (112). */}
            {canIssue ? <TableHead col="actions" className="w-11"><span className="sr-only">{t('columns.actions')}</span></TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const state = noticeStateDisplay(row);
            const actions = noticeActions(row);
            // Endzustand gedämpft (MUSTER § G, Runde 4, 112): Ein ersetzter oder irrtümlich erfasster Bescheid ist eine graue
            // Zeile mit Marke am Namen; die Statusspalte zeigt nur die übrigen Zustände.
            const ended = state.key === 'superseded' || state.key === 'supersededByFinal' || state.key === 'voided';
            const mutedLabel = !ended ? undefined : state.key === 'voided' ? t('state.voided') : t('state.supersededShort');
            return (
              <TableRow key={row.id} data-testid="notice-row" muted={mutedLabel}>
                {/* Bescheid und Geltung dürfen umbrechen (Unterzeilen): Einzeilig liefen
                    die sechs Spalten bei 1440 px seitlich über (release-0.2.7.md, Befund 14). */}
                <TableCell col="title" className="whitespace-normal" mutedMark="inline">
                  {tk(row.kind)}
                  <MutedMark />
                  {/* 09 B25: Das Datum der Ersetzung steht klein hinter der Marke. */}
                  {state.key === 'superseded' && state.date ? <span data-testid="notice-state-date" className="ml-1 text-hint text-muted-ink">{t('state.supersededOn', { date: date(state.date) })}</span> : null}
                  <span className="block text-hint text-muted-ink">{row.taxOffice} · <span className="font-mono">{row.taxNumber}</span></span>
                </TableCell>
                <TableCell col="meta" className="tabular-nums">{date(row.noticeDate)}</TableCell>
                <TableCell col="meta" className="whitespace-normal">
                  <span className="whitespace-nowrap tabular-nums"><span data-testid="notice-exempt-from">{date(row.exemptFrom)}</span> – {date(row.validUntil)}</span>
                  {row.assessmentPeriod ? <span className="block text-hint text-muted-ink">{t('assessmentPeriodLine', { period: row.assessmentPeriod })}</span> : null}
                </TableCell>
                <TableCell col="meta" data-testid="notice-document">
                  {/* 112 (Joe 2026-10-17): Ein Bescheid ohne Dokument in der Akte ist Arbeit — das Original gehört abgelegt. Nur
                      solange er gilt: Ein ersetzter oder irrtümlich erfasster Bescheid zeigt „—“ (Joe, nach Runde 4).
                      Mono trägt nur die Nummer; Marke und Leerwert stehen in der Textschrift (Runde 4, 194). */}
                  {row.documentNumber ? <span className="font-mono">{row.documentNumber}</span> : ended ? <Empty /> : <StatusBadge tone="warning" dot>{t('withoutDocument')}</StatusBadge>}
                </TableCell>
                <TableCell col="status">
                  {isNormalInList('notice', state.key) || ended ? null : (
                    <StatusBadge tone={statusTone('notice', state.key)}>
                      <span data-testid="notice-state">{t(`state.${state.key}`, { date: state.date ? date(state.date) : '' })}</span>
                    </StatusBadge>
                  )}
                </TableCell>
                {canIssue ? (
                  <TableCell col="actions" className="text-right">
                    <RowMenu
                      name={tk(row.kind)}
                      testId="notice-menu"
                      items={[
                        { key: 'attach', label: t('actions.attach'), hidden: !actions.attach, onSelect: () => setAttach(row) },
                        { key: 'supersede', label: t('actions.supersede'), hidden: !actions.supersede, onSelect: () => setSupersede(row) },
                        { key: 'void', label: t('actions.void'), hidden: !actions.void, onSelect: () => setVoiding(row) },
                      ]}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {supersede ? <SupersedeDialog notice={supersede} canPickDocument={canPickDocument} onClose={() => setSupersede(null)} /> : null}
      {voiding ? <VoidNoticeDialog notice={voiding} onClose={() => setVoiding(null)} /> : null}
      <NoticeDialog open={attach !== null} onOpenChange={(open) => { if (!open) setAttach(null); }} canPickDocument={canPickDocument} attachTo={attach ?? undefined} />
    </>
  );
}

function SupersedeDialog({ notice, canPickDocument, onClose }: { notice: NoticeRow; canPickDocument: boolean; onClose: () => void }) {
  const ts = useTranslations('finance.donations.notices.supersede');
  const router = useRouter();
  const [supersededOn, setSupersededOn] = useState('');
  const [doc, setDoc] = useState<PickedDocument | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const submit = async () => {
    setPending(true);
    const result = await feedback.run(() => supersedeNoticeAction({ id: notice.id, supersededOn, documentId: doc?.id ?? null }), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') {
      onClose();
      router.refresh();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="md" className="bg-surface shadow-md">
        <DialogTitle>{ts('title')}</DialogTitle>
        <p className="text-meta text-ink-2">{ts('hint')}</p>
        <FormGrid>
          <FormField id="notice-superseded-on" label={ts('date')} required size="s">
            <Input id="notice-superseded-on" type="date" value={supersededOn} onChange={(e) => setSupersededOn(e.target.value)} />
          </FormField>
          {canPickDocument ? (
            <FormCell size="m">
              <DocumentPicker id="notice-superseded-document" name="supersededDocumentId" label={ts('document')} value={doc} onChange={setDoc} />
            </FormCell>
          ) : null}
        </FormGrid>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={supersededOn === ''} saveLabel={ts('save')} onSave={() => void submit()} state={feedback.state} />
      </DialogContent>
    </Dialog>
  );
}

function VoidNoticeDialog({ notice, onClose }: { notice: NoticeRow; onClose: () => void }) {
  const tv = useTranslations('finance.donations.notices.void');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const submit = async () => {
    setPending(true);
    const result = await feedback.run(() => voidNoticeAction({ id: notice.id, note }), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') {
      onClose();
      router.refresh();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="md" className="bg-surface shadow-md">
        <DialogTitle>{tv('title')}</DialogTitle>
        <DialogDescription tone="body">{tv('hint')}</DialogDescription>
        <FormGrid>
          <FormField id="notice-void-note" label={tv('reason')} required size="l">
            <Textarea id="notice-void-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </FormGrid>
        <FormActionBar placement="dialog" cancel={onClose} destructive pending={pending} saveDisabled={note.trim() === ''} saveLabel={tv('submit')} onSave={() => void submit()} state={feedback.state} />
      </DialogContent>
    </Dialog>
  );
}

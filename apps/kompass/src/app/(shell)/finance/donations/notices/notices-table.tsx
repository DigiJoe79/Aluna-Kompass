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
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { noticeActions, noticeStateDisplay } from '@/lib/finance/notices';
import { supersedeNoticeAction, voidNoticeAction } from './actions';
import { NoticeDialog, type SavedNotice } from './notice-dialog';

export type NoticeRow = Pick<NoticeView, 'id' | 'kind' | 'taxOffice' | 'taxNumber' | 'noticeDate' | 'exemptFrom' | 'assessmentPeriod' | 'purposesText' | 'purposesTextAccusative' | 'validUntil' | 'state' | 'supersededOn' | 'voidedAt' | 'documentId' | 'documentNumber' | 'supersededDocumentNumber'>;

const TONE = { valid: 'success', endsOn: 'warning', expired: 'neutral', superseded: 'neutral', supersededByFinal: 'neutral', voided: 'neutral', future: 'neutral' } as const;

/**
 * Die Reihe der Bescheide (C3), verdichtet auf sechs Spalten (K9-Befund 8),
 * damit sie auf einer `standard`-Seite nicht waagerecht scrollt: Bescheid (Art
 * in Alltagssprache, darunter Finanzamt · Steuernummer) · vom · gilt (Befreiung
 * ab – gültig bis, taggenau; darunter der Veranlagungszeitraum) · Dokument ·
 * Zustand. Handeln mit `finance.donationsIssue`: aufgehoben oder
 * ersetzt am …, irrtümlich erfasst, Dokument nachreichen.
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
            <TableHead>{t('columns.notice')}</TableHead>
            <TableHead>{t('columns.noticeDate')}</TableHead>
            <TableHead>{t('columns.validity')}</TableHead>
            <TableHead>{t('columns.document')}</TableHead>
            <TableHead>{t('columns.state')}</TableHead>
            {canIssue ? <TableHead className="text-right">{t('columns.actions')}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const state = noticeStateDisplay(row);
            const actions = noticeActions(row);
            return (
              <TableRow key={row.id} data-testid="notice-row">
                {/* Bescheid und Geltung dürfen umbrechen (Unterzeilen): Einzeilig liefen
                    die sechs Spalten bei 1440 px seitlich über (release-0.2.7.md, Befund 14). */}
                <TableCell className="whitespace-normal">
                  {tk(row.kind)}
                  <span className="block text-[12px] text-muted-ink">{row.taxOffice} · <span className="font-mono">{row.taxNumber}</span></span>
                </TableCell>
                <TableCell className="font-mono tabular-nums">{date(row.noticeDate)}</TableCell>
                <TableCell className="whitespace-normal">
                  <span className="whitespace-nowrap font-mono tabular-nums"><span data-testid="notice-exempt-from">{date(row.exemptFrom)}</span> – {date(row.validUntil)}</span>
                  {row.assessmentPeriod ? <span className="block text-[12px] text-muted-ink">{t('assessmentPeriodLine', { period: row.assessmentPeriod })}</span> : null}
                </TableCell>
                <TableCell data-testid="notice-document" className="font-mono">{row.documentNumber ?? <span className="font-sans text-muted-ink">{t('noDocument')}</span>}</TableCell>
                <TableCell>
                  <StatusBadge tone={TONE[state.key]}>
                    <span data-testid="notice-state">{t(`state.${state.key}`, { date: state.date ? date(state.date) : '' })}</span>
                  </StatusBadge>
                </TableCell>
                {canIssue ? (
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {actions.attach ? <Button type="button" size="sm" variant="outline" onClick={() => setAttach(row)}>{t('actions.attach')}</Button> : null}
                      {actions.supersede ? <Button type="button" size="sm" variant="outline" onClick={() => setSupersede(row)}>{t('actions.supersede')}</Button> : null}
                      {actions.void ? <Button type="button" size="sm" variant="ghost" onClick={() => setVoiding(row)}>{t('actions.void')}</Button> : null}
                    </div>
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
        <DialogTitle className="font-heading text-[19px]">{ts('title')}</DialogTitle>
        <p className="text-[13px] text-ink-2">{ts('hint')}</p>
        <FormGrid>
          <FormField id="notice-superseded-on" label={ts('date')} required size="s">
            <Input id="notice-superseded-on" type="date" className="font-mono" value={supersededOn} onChange={(e) => setSupersededOn(e.target.value)} />
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
        <DialogTitle className="font-heading text-[19px]">{tv('title')}</DialogTitle>
        <p className="text-[13px] text-ink-2">{tv('hint')}</p>
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

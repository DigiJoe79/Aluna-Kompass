'use client';

import type { NoticeView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { noticeActions, noticeStateDisplay } from '@/lib/finance/notices';
import { supersedeNoticeAction, voidNoticeAction } from './actions';
import { NoticeDialog, type SavedNotice } from './notice-dialog';

export type NoticeRow = Pick<NoticeView, 'id' | 'kind' | 'taxOffice' | 'taxNumber' | 'noticeDate' | 'exemptFrom' | 'assessmentPeriod' | 'purposesText' | 'validUntil' | 'state' | 'supersededOn' | 'voidedAt' | 'documentId' | 'documentNumber' | 'supersededDocumentNumber'>;

const TONE = { valid: 'success', endsOn: 'warning', expired: 'neutral', superseded: 'neutral', supersededByFinal: 'neutral', voided: 'neutral', future: 'neutral' } as const;

/**
 * Die Reihe der Bescheide (C3): Art in Alltagssprache · Finanzamt ·
 * Steuernummer · Datum · Befreiung ab · Veranlagungszeitraum · gültig bis (taggenau) ·
 * Dokument · Zustand. Handeln mit `finance.donationsIssue`: aufgehoben oder
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
            <TableHead>{t('columns.kind')}</TableHead>
            <TableHead>{t('columns.taxOffice')}</TableHead>
            <TableHead>{t('columns.taxNumber')}</TableHead>
            <TableHead>{t('columns.noticeDate')}</TableHead>
            <TableHead>{t('columns.exemptFrom')}</TableHead>
            <TableHead>{t('columns.assessmentPeriod')}</TableHead>
            <TableHead>{t('columns.validUntil')}</TableHead>
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
                <TableCell>{tk(row.kind)}</TableCell>
                <TableCell>{row.taxOffice}</TableCell>
                <TableCell className="font-mono">{row.taxNumber}</TableCell>
                <TableCell className="font-mono tabular-nums">{date(row.noticeDate)}</TableCell>
                <TableCell data-testid="notice-exempt-from" className="font-mono tabular-nums">{date(row.exemptFrom)}</TableCell>
                <TableCell>{row.assessmentPeriod ?? '—'}</TableCell>
                <TableCell className="font-mono tabular-nums">{date(row.validUntil)}</TableCell>
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

  const submit = async () => {
    setPending(true);
    const result = await supersedeNoticeAction({ id: notice.id, supersededOn, documentId: doc?.id ?? null });
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      onClose();
      router.refresh();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[520px]">
        <DialogTitle className="font-heading text-[19px]">{ts('title')}</DialogTitle>
        <p className="text-[13px] text-ink-2">{ts('hint')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="notice-superseded-on" required>{ts('date')}</Label>
          <Input id="notice-superseded-on" type="date" className="font-mono" value={supersededOn} onChange={(e) => setSupersededOn(e.target.value)} />
        </div>
        {canPickDocument ? <DocumentPicker id="notice-superseded-document" name="supersededDocumentId" label={ts('document')} value={doc} onChange={setDoc} /> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{ts('cancel')}</Button>
          <Button type="button" disabled={pending || supersededOn === ''} onClick={() => void submit()}>{ts('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidNoticeDialog({ notice, onClose }: { notice: NoticeRow; onClose: () => void }) {
  const tv = useTranslations('finance.donations.notices.void');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    const result = await voidNoticeAction({ id: notice.id, note });
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      onClose();
      router.refresh();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[520px]">
        <DialogTitle className="font-heading text-[19px]">{tv('title')}</DialogTitle>
        <p className="text-[13px] text-ink-2">{tv('hint')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="notice-void-note" required>{tv('reason')}</Label>
          <Textarea id="notice-void-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{tv('cancel')}</Button>
          <Button type="button" variant="destructive" disabled={pending || note.trim() === ''} onClick={() => void submit()}>{tv('submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

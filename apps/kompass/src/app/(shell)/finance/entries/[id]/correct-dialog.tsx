'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { AllocationLineView } from '@kompass/module-finance';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { reverseEntryAction, requestCorrectionAction } from '../actions';

type PartyGroup = { contact: boolean; project: boolean; purpose: boolean; abroad: boolean };
type NumberGroup = { amount: boolean; date: boolean; account: boolean; category: boolean; vat: boolean };

export interface CorrectDialogEntry {
  id: string;
  allocationLines: Pick<AllocationLineView, 'id' | 'contactId' | 'projectId' | 'purposeId' | 'abroad'>[];
}

export function CorrectDialog({
  entry,
  purposes,
  projects,
  contactNames,
}: {
  entry: CorrectDialogEntry;
  purposes: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  contactNames: Map<string, string>;
}) {
  const t = useTranslations('finance.entryView.correct');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [party, setParty] = useState<PartyGroup>({ contact: false, project: false, purpose: false, abroad: false });
  const [numbers, setNumbers] = useState<NumberGroup>({ amount: false, date: false, account: false, category: false, vat: false });
  const [note, setNote] = useState('');
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [projectId, setProjectId] = useState('');
  const [purposeId, setPurposeId] = useState('');
  const [abroad, setAbroad] = useState(false);
  const [withCorrectionDraft, setWithCorrectionDraft] = useState(true);
  const [cashReason, setCashReason] = useState<string | null>(null);
  const [cashReasonText, setCashReasonText] = useState('');

  const firstLine = entry.allocationLines[0];
  const anyNumbers = Object.values(numbers).some(Boolean);
  const anyParty = Object.values(party).some(Boolean);
  const path: 'reverse' | 'allocation' | null = anyNumbers ? 'reverse' : anyParty ? 'allocation' : null;

  const close = () => {
    setOpen(false);
    setParty({ contact: false, project: false, purpose: false, abroad: false });
    setNumbers({ amount: false, date: false, account: false, category: false, vat: false });
    setNote('');
    setCashReason(null);
  };

  const submitAllocation = async () => {
    if (!firstLine) return;
    const changes: Record<string, unknown> = {};
    if (party.contact) changes.contactId = contact?.id ?? null;
    if (party.project) changes.projectId = projectId || null;
    if (party.purpose) changes.purposeId = purposeId || null;
    if (party.abroad) changes.abroad = abroad;
    const result = await requestCorrectionAction(firstLine.id, changes, note);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      close();
      router.refresh();
    }
  };

  const submitReversal = async (reason?: string) => {
    const result = await reverseEntryAction(entry.id, withCorrectionDraft, reason);
    if (result.status === 'error') {
      if (result.code === 'cashNegativeNeedsReason') {
        setCashReason(result.detail ?? result.message);
        return;
      }
      toast.error(result.message);
      return;
    }
    if (result.status !== 'success') return;
    close();
    const data = result.data as { reversal: { id: string }; correctionDraft: { id: string } | null };
    if (data.correctionDraft) router.push(`/finance/entries/${data.correctionDraft.id}/edit`);
    else router.push(`/finance/entries/${data.reversal.id}`);
  };

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {t('trigger')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="bg-surface shadow-md">
          <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>

          <fieldset className="space-y-2">
            <legend className="text-[12px] font-semibold uppercase tracking-wide text-muted-ink">{t('groupParty')}</legend>
            {(['contact', 'project', 'purpose', 'abroad'] as const).map((key) => (
              <label key={key} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={party[key]} onChange={(e) => setParty((p) => ({ ...p, [key]: e.target.checked }))} />
                {t(`party.${key}`)}
                {key === 'contact' && firstLine?.contactId ? (
                  <span className="text-[12px] text-muted-ink">{t('currentlyValue', { value: contactNames.get(firstLine.contactId) ?? '' })}</span>
                ) : null}
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-[12px] font-semibold uppercase tracking-wide text-muted-ink">{t('groupNumbers')}</legend>
            {(['amount', 'date', 'account', 'category', 'vat'] as const).map((key) => (
              <label key={key} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={numbers[key]} onChange={(e) => setNumbers((n) => ({ ...n, [key]: e.target.checked }))} />
                {t(`numbers.${key}`)}
              </label>
            ))}
          </fieldset>

          {path ? <p className="text-[13px] font-semibold text-ink">{t(path === 'reverse' ? 'pathReverse' : 'pathAllocation')}</p> : null}

          {path === 'allocation' && firstLine ? (
            <div className="space-y-3 border-t border-line pt-3">
              {party.contact ? (
                <ContactPicker id="correct-contact" name="correctContact" label={t('party.contact')} value={contact} onChange={setContact} />
              ) : null}
              {party.project ? (
                <div className="space-y-1">
                  <label htmlFor="correct-project" className="text-[13px] font-semibold text-ink-2">{t('party.project')}</label>
                  <Select id="correct-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    <option value="">—</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </div>
              ) : null}
              {party.purpose ? (
                <div className="space-y-1">
                  <label htmlFor="correct-purpose" className="text-[13px] font-semibold text-ink-2">{t('party.purpose')}</label>
                  <Select id="correct-purpose" value={purposeId} onChange={(e) => setPurposeId(e.target.value)}>
                    <option value="">—</option>
                    {purposes.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </div>
              ) : null}
              {party.abroad ? (
                <label className="flex items-center gap-2 text-[13px]">
                  <Switch checked={abroad} onCheckedChange={(c) => setAbroad(c === true)} />
                  {t('party.abroad')}
                </label>
              ) : null}
              <label className="block space-y-1 text-[13px]">
                <span className="font-semibold">{t('noteLabel')}</span>
                <textarea required value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-sm border border-line-strong bg-field px-2.5 py-1.5 text-[13px]" rows={2} />
              </label>
            </div>
          ) : null}

          {path === 'reverse' ? (
            <div className="space-y-3 border-t border-line pt-3">
              <ol className="list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
                <li>{t('reverse.step1')}</li>
                <li>{t('reverse.step2')}</li>
                <li>{t('reverse.step3')}</li>
              </ol>
              <label className="flex items-center gap-2 text-[13px]">
                <Switch checked={withCorrectionDraft} onCheckedChange={(c) => setWithCorrectionDraft(c === true)} />
                {t('reverse.withDraft')}
              </label>
              {cashReason ? (
                <Notice level="warn" reason={{ name: 'cashReason', value: cashReasonText, onChange: setCashReasonText, label: t('reverse.cashReasonLabel') }}>
                  {cashReason}
                </Notice>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              {t('cancel')}
            </Button>
            {path === 'allocation' ? (
              <Button type="button" disabled={note.trim().length === 0} onClick={() => void submitAllocation()}>
                {t('submitAllocation')}
              </Button>
            ) : path === 'reverse' ? (
              <Button
                type="button"
                disabled={cashReason !== null && cashReasonText.trim().length === 0}
                onClick={() => void submitReversal(cashReason ? cashReasonText : undefined)}
              >
                {t('submitReverse')}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

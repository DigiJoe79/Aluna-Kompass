'use client';

import type { FilingContext } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatusBadge, statusTone } from '@/components/status-badge';
import type { ActionState } from '@/lib/actions';
import { completeFilingAction, interimOrderAction, renotarizeAction, resolveInterimAction, saveTransparencyAction, setFilingDocumentsAction, updateFilingAction } from '../actions';
import { FilingDialogView, type FilingDialog, type FilingDialogValues } from './dialogs';
import { FilingStepsCard } from './filing-steps-card';
import { RequirementsCard } from './requirements-card';
import { TransparencyCard } from './transparency-card';

async function submit(filingId: string, d: FilingDialog, v: FilingDialogValues): Promise<ActionState> {
  switch (d.kind) {
    case 'notary':
      return updateFilingAction(filingId, { notarizedOn: v.day, ...(v.notary ? { notaryContactId: v.notary.id } : {}) });
    case 'renotarize':
      return renotarizeAction(filingId, v.day, d.index);
    case 'submitted':
      return updateFilingAction(filingId, { submittedOn: v.day });
    case 'resolveInterim':
      return resolveInterimAction(filingId, d.index, v.day);
    case 'interim':
      return interimOrderAction({ filingId, on: v.day, ...(v.deadline ? { deadline: v.deadline } : {}), ...(v.document ? { documentId: v.document.id } : {}) });
    case 'complete':
      return completeFilingAction({ filingId, registeredOn: v.day, ...(v.court.trim() ? { registerCourt: v.court.trim() } : {}), ...(v.number.trim() ? { registerNumber: v.number.trim() } : {}), ...(v.document ? { extractDocumentId: v.document.id } : {}) });
    case 'attach':
      return setFilingDocumentsAction(filingId, d.key, v.document ? [v.document.id] : []);
    case 'confirmation':
      return saveTransparencyAction({ filingId, answers: {}, checkedOn: v.day, confirmationDocumentId: v.document?.id ?? null });
  }
}

/** Die Anmeldung als Vorgang (Board 8b): Kopf, Schritte, Unterlagen, Transparenzregister und die Dialoge dazu. */
export function FilingWorkspace({ context, back, title, description, manage, today, canPickContacts, canPickDocuments }: { context: FilingContext; back: { href: string; label: string }; title: string; description: string; manage: boolean; today: string; canPickContacts: boolean; canPickDocuments: boolean }) {
  const t = useTranslations('governance');
  const [dialog, setDialog] = useState<FilingDialog | null>(null);
  const f = context.filing;
  return (
    <>
      <PageHeader
        back={back}
        title={title}
        description={description}
        status={<StatusBadge tone={statusTone('registration', f.state)} dot>{t(`states.registration.${f.state}`)}</StatusBadge>}
        more={manage && f.submittedOn && !f.registeredOn ? [{ key: 'interim', label: t('register.interimMenu'), onSelect: () => setDialog({ kind: 'interim' }) }] : []}
      />
      <div className="flex flex-col gap-4">
        <FilingStepsCard context={context} manage={manage} open={setDialog} />
        <RequirementsCard context={context} manage={manage} open={setDialog} />
        {f.transparency.result !== 'notApplicable' ? <TransparencyCard filingId={f.id} view={f.transparency} submittedOn={f.submittedOn} overdueDays={context.overdueDays} today={today} manage={manage} onConfirm={() => setDialog({ kind: 'confirmation' })} /> : null}
      </div>
      {dialog ? <FilingDialogView dialog={dialog} today={today} register={context.register ?? { court: '', number: '' }} canPickContacts={canPickContacts} canPickDocuments={canPickDocuments} submit={(d, v) => submit(f.id, d, v)} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

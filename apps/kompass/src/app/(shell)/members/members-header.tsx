'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { issueCountCertificateAction } from './actions';

/**
 * Kopf der Mitgliederliste (Handoff Mitglieder 2.1): Primär „Mitglied anlegen“, Nebenaktionen „Liste exportieren (CSV)“
 * und „Bescheinigung Mitgliederzahl …“ (Dialog `sm` mit Stichtag). Ohne Einrichtung (1d) steht nur der Titel.
 */
export function MembersHeader({ canCreate, canCertify, exportHref, today, setup }: { canCreate: boolean; canCertify: boolean; exportHref: string; today: string; setup: boolean }) {
  const t = useTranslations('members.list');
  const [certifying, setCertifying] = useState(false);
  return (
    <>
      <PageHeader
        title={t('title')}
        more={
          setup
            ? []
            : [
                { key: 'export', label: t('exportCsv'), href: exportHref, testId: 'members-export' },
                { key: 'certificate', label: t('countCertificate'), onSelect: () => setCertifying(true), hidden: !canCertify, testId: 'members-certificate' },
              ]
        }
        actions={canCreate && !setup ? <Link href="/members/new" className={buttonVariants()}>{t('create')}</Link> : null}
      />
      {certifying ? <CertificateDialog today={today} onClose={() => setCertifying(false)} /> : null}
    </>
  );
}

function CertificateDialog({ today, onClose }: { today: string; onClose: () => void }) {
  const tc = useTranslations('members.certificate');
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const submit = async () => {
    setPending(true);
    const result = await feedback.run(() => issueCountCertificateAction({ date }), { retry: () => void submit() });
    setPending(false);
    if (result.status !== 'success') return;
    const { documentId } = result.data as { documentId: string };
    toast.success(result.message, { action: { label: tc('open'), onClick: () => router.push(`/dms/${documentId}`) } });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{tc('title')}</DialogTitle>
          <DialogDescription>{tc('text')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="certificate-date" label={tc('date')} required size="s">
              <Input id="certificate-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!date} saveLabel={tc('submit')} onSave={() => void submit()} state={feedback.state} testId="certificate-footer" />
      </DialogContent>
    </Dialog>
  );
}

'use client';

import type { StatuteState } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { PageHeader } from '@/components/page-header';
import { RecordActions } from '@/components/record-actions';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { deleteStatuteDraftAction, registerStatuteAction } from '../actions';

/**
 * Kopf eines Satzungsstands (Vorgang, MUSTER § C): „Bearbeiten“ primär, „Eintragung vermerken …“ als Nebenaktion bei
 * beschlossenem Stand, „Löschen …“ im ⋯ nur beim Entwurf.
 */
export function StatuteHeader({ id, state, stateLabel, title, description, manage, today, back }: { id: string; state: StatuteState; stateLabel: string; title: string; description: ReactNode; manage: boolean; today: string; back: { href: string; label: string } }) {
  const t = useTranslations('governance.statute');
  const router = useRouter();
  const more = useRef<HTMLButtonElement>(null);
  const [registering, setRegistering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [on, setOn] = useState(today);
  return (
    <>
      <PageHeader
        back={back}
        title={title}
        description={description}
        status={<StatusBadge tone={statusTone('statute', state)} dot>{stateLabel}</StatusBadge>}
        more={manage && state === 'resolved' ? [{ key: 'register', label: t('registerMenu'), onSelect: () => setRegistering(true) }] : []}
        actions={
          manage ? (
            <>
              <Link href={`/governance/statutes/${id}/edit`} className={buttonVariants()}>{t('edit')}</Link>
              {state === 'draft' ? <RecordActions triggerRef={more} actions={[{ key: 'delete', label: t('deleteMenu'), kind: 'delete', onSelect: () => setDeleting(true) }]} /> : null}
            </>
          ) : undefined
        }
      />
      <ConfirmDialog
        open={registering}
        onOpenChange={setRegistering}
        title={t('registerTitle')}
        description={t('registerDescription')}
        confirmLabel={t('registerConfirm')}
        action={async () => {
          const result = await registerStatuteAction(id, on);
          if (result.status === 'success') router.refresh();
          return result;
        }}
      >
        <FormGrid>
          <FormField id="statute-registered-on" label={t('registeredOn')} required size="s">
            <Input id="statute-registered-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          </FormField>
        </FormGrid>
      </ConfirmDialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('deleteTitle')}
        description={t('deleteDescription')}
        confirmLabel={t('deleteConfirm')}
        destructive
        finalFocus={more}
        action={async () => {
          const result = await deleteStatuteDraftAction(id);
          if (result.status === 'success') router.push('/governance/statutes');
          return result;
        }}
      />
    </>
  );
}

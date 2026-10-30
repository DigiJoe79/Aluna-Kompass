'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { recordNameConsentAction } from '../../finance/tax/actions';

/**
 * „Einwilligung erfassen“ bzw. „Widerruf erfassen“ (Designer 2a, Spec Teil J): Tag, bei der Einwilligung das erste Jahr,
 * optional das Schreiben aus der Akte. Die Beschreibung nennt Umfang und Widerrufsrecht. Ein Tag in der Zukunft, ein
 * Widerruf ohne geltende Einwilligung — das prüft der Dienst.
 */
export function NameConsentDialog({ open, onOpenChange, contactId, contactKind = 'person', kind, today, lastClosedYear }: { open: boolean; onOpenChange: (open: boolean) => void; contactId: string; /** Satz nach Art des Kontakts: „Die Organisation willigt ein …“ (Bildabnahme 0.4.5 T-3). */ contactKind?: 'person' | 'organization'; kind: 'granted' | 'revoked'; today: string; lastClosedYear: number }) {
  const t = useTranslations('finance.contactAnnualAccounts.dialog');
  const router = useRouter();
  const [on, setOn] = useState(today);
  const [fromYear, setFromYear] = useState(String(lastClosedYear));
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setOn(today);
    setFromYear(String(lastClosedYear));
    setDocument(null);
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const granting = kind === 'granted';
  const save = async () => {
    setPending(true);
    const input = granting ? { contactId, kind, on, fromYear: Number(fromYear), documentId: document?.id ?? null } : { contactId, kind, on, documentId: document?.id ?? null };
    const result = await feedback.run(() => recordNameConsentAction(input), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="name-consent-dialog">
        <DialogHeader>
          <DialogTitle>{t(granting ? 'grantTitle' : 'revokeTitle')}</DialogTitle>
          <DialogDescription tone="body">{t(granting ? 'grantDescription' : 'revokeDescription', { kind: contactKind })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="name-consent-on" label={t(granting ? 'grantedOn' : 'revokedOn')} required error={fieldErrors.on} size="s">
              <Input id="name-consent-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
            </FormField>
            {granting ? (
              <FormField id="name-consent-from-year" label={t('fromYear')} required error={fieldErrors.fromYear} size="s">
                <Input id="name-consent-from-year" type="number" inputMode="numeric" value={fromYear} onChange={(e) => setFromYear(e.target.value)} />
              </FormField>
            ) : null}
            {/* Das Feld trägt seine Beschriftung selbst (`FormField` im Baustein). */}
            <DocumentPicker id="name-consent-document" name="documentId" label={t('document')} value={document} onChange={setDocument} />
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="create" cancel={() => onOpenChange(false)} pending={pending} onSave={() => void save()} state={withUnplacedFieldErrors(feedback.state, ['on', 'fromYear'])} />
      </DialogContent>
    </Dialog>
  );
}

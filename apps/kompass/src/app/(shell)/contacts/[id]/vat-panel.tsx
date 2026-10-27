'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Checkbox } from '@/components/ui/checkbox';
import { Segmented } from '@/components/ui/segmented';
import { clearReverseChargeDeclineAction, saveContactTaxDetailsAction } from '../../finance/tax/actions';
import { useDateFormat } from '@/components/date-format-provider';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { Button } from '@/components/ui/button';
import type { ReverseChargeDeclineReason } from '@kompass/module-finance/codes';

type Seat = 'eu' | 'other';

/** E6b: das gemerkte „Nein, weil …“ der Prüffrage § 13b, mit dem Namen der Person. */
export interface ContactVatDecline {
  reason: ReverseChargeDeclineReason;
  text: string | null;
  on: string;
  byName: string | null;
}

/**
 * Plan E6a Task 11c — Abschnitt „Umsatzsteuer“ am Kontakt (Board Umsatzsteuer 2a A): das Merkmal „Rechnungen mit
 * Umkehr der Steuerschuld (§ 13b)“ mit dem Sitz des Anbieters; es gibt jeder Ausgabe an den Kontakt das Kennzeichen
 * vor (EU → „§ 13b, Leistung aus der EU“, Drittland → „§ 13b, übrige“). Nur, wenn der Verein Unternehmer ist; lesen mit
 * `finance.read`, ändern mit `finance.entriesWrite` (`saveContactTaxDetails`). Seit E6b steht darunter das gemerkte Nein
 * der Prüffrage (2a B) mit Grund, Person und Tag und dem Link „Wieder fragen“.
 */
export function ContactVatPanel({ contactId, entrepreneur, reverseCharge, decline = null, canEdit }: { contactId: string; entrepreneur: boolean; reverseCharge: Seat | null; decline?: ContactVatDecline | null; canEdit: boolean }) {
  const t = useTranslations('finance.contactVat');
  const tReasons = useTranslations('finance.reverseChargePrompt.reasons');
  const fmt = useDateFormat();
  const askAgain = useActionFeedback();
  const router = useRouter();
  const [on, setOn] = useState(reverseCharge !== null);
  const [seat, setSeat] = useState<Seat>(reverseCharge ?? 'eu');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  if (!entrepreneur) return null;

  const next: Seat | null = on ? seat : null;
  const count = next !== reverseCharge ? 1 : 0;
  const save = async () => {
    if (count === 0) return;
    setPending(true);
    const result = await feedback.run(() => saveContactTaxDetailsAction({ contactId, reverseCharge: next }), { retry: () => void save() });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  return (
    <FormCard data-testid="contact-vat">
      <FormCardBody>
        <Section title={t('title')}>
          <FormGrid>
            <FormField id="contact-vat-reverse-charge" label={t('reverseCharge')} hint={t('reverseChargeHint')} toggle size="l">
              <Checkbox id="contact-vat-reverse-charge" checked={on} disabled={!canEdit || pending} onCheckedChange={(checked) => setOn(checked === true)} />
            </FormField>
            {on ? (
              <FormField id="contact-vat-seat" label={t('seat')} size="m">
                <Segmented<Seat>
                  aria-label={t('seat')}
                  value={seat}
                  disabled={!canEdit || pending}
                  onValueChange={setSeat}
                  options={[
                    { value: 'eu', label: t('eu') },
                    { value: 'other', label: t('other') },
                  ]}
                />
              </FormField>
            ) : null}
          </FormGrid>
          {decline ? (
            <div className="mt-3 space-y-2" data-testid="contact-vat-decline">
              <RefusalNotice action state={askAgain.state} />
              <p className="text-meta text-ink-2">
                {t('decline', { reason: decline.reason === 'other' && decline.text ? decline.text : tReasons(decline.reason), person: decline.byName ?? '', date: fmt.date(decline.on) })}{' '}
                {canEdit ? (
                  <Button type="button" variant="link" className="h-auto p-0 align-baseline" onClick={() => void askAgain.run(() => clearReverseChargeDeclineAction(contactId)).then((r) => r.status === 'success' && router.refresh())}>
                    {t('askAgain')}
                  </Button>
                ) : null}
              </p>
            </div>
          ) : null}
        </Section>
      </FormCardBody>
      {canEdit ? (
        <FormActionBar
          count={count}
          pending={pending}
          saveTestId="contact-vat-save"
          state={feedback.state}
          onDiscard={() => {
            setOn(reverseCharge !== null);
            setSeat(reverseCharge ?? 'eu');
            feedback.reset();
          }}
          onSave={() => void save()}
        />
      ) : null}
    </FormCard>
  );
}

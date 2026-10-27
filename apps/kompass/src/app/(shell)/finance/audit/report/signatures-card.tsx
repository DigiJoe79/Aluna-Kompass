'use client';

import type { AuditReportView, SignatureMode } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { saveSignaturesAction } from '../actions';
import { useLastChanged } from './card-note';
import { joinNames } from '../audit-header';
import { TIGHT } from './subject-block';
import { useUnsavedCard } from './unsaved-cards';

const MODES: readonly SignatureMode[] = ['both', 'one', 'separate'];

/**
 * Karte „Unterschriften“ (Board 12d): beide einen Bericht (Vorgabe), einer unterschreibt — mit „Unterschreibt nicht“
 * und „Grund*“, der im Druck steht — oder jeder einen eigenen Bericht. Drei Optionen mit Unterzeile: `RadioGroup`.
 */
export function SignaturesCard({ report, canEdit, names }: { report: AuditReportView; canEdit: boolean; names: Record<string, string> }) {
  const t = useTranslations('finance.audit.report.signatures');
  const tAudit = useTranslations('finance.audit');
  const router = useRouter();
  const lastChanged = useLastChanged(names);
  const sig = report.signatures;
  const initial = { mode: sig.mode, nonSigner: sig.nonSignerAuditorId ?? '', reason: sig.nonSignerReason ?? '' };
  const [v, setV] = useState(initial);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const changed = [v.mode !== initial.mode, v.mode === 'one' && v.nonSigner !== initial.nonSigner, v.mode === 'one' && v.reason !== initial.reason].filter(Boolean).length;
  useUnsavedCard('signatures', t('title'), canEdit && changed > 0);

  const save = async () => {
    setPending(true);
    const result = await feedback.run(
      () => saveSignaturesAction({ reportId: report.id, expectedVersion: sig.version, mode: v.mode, nonSignerAuditorId: v.mode === 'one' ? v.nonSigner || null : null, nonSignerReason: v.mode === 'one' ? v.reason.trim() || null : null }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  if (!canEdit) {
    const nonSigner = report.auditors.find((a) => a.id === sig.nonSignerAuditorId);
    const signers = report.auditors.filter((a) => sig.mode !== 'one' || a.id !== sig.nonSignerAuditorId).map((a) => a.contactName);
    return (
      <FormCard as="section" data-testid="signatures-card">
        <FormCardBody>
          <Section title={t('title')}>
            <FormGrid>
              <FixedValue id="signature-mode" label={t('mode')} value={t(`modes.${sig.mode}.label`)} describedBy="signature-note" size="full" className={TIGHT} />
              {/* Die Namen derer, die unterschreiben (Designer Runde 7, 284). */}
              <FixedValue id="signature-names" label={t('signers')} value={signers.length > 0 ? joinNames(signers, tAudit('head.and')) : null} describedBy="signature-note" size="full" className={TIGHT} />
              {sig.mode === 'one' ? (
                <>
                  <FixedValue id="signature-non-signer" label={t('nonSigner')} value={nonSigner?.contactName ?? null} describedBy="signature-note" size="m" className={TIGHT} />
                  <FixedValue id="signature-reason" label={t('reason')} value={sig.nonSignerReason} describedBy="signature-note" size="m" className={TIGHT} />
                </>
              ) : null}
            </FormGrid>
            <p id="signature-note" className="mt-2 text-hint text-muted-ink">
              {lastChanged(sig.updatedByUserId, sig.updatedAt) ?? ''}
            </p>
          </Section>
        </FormCardBody>
      </FormCard>
    );
  }

  return (
    <FormCard
      as="form"
      data-testid="signatures-card"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void save();
      }}
    >
      <FormCardBody>
        <Section title={t('title')}>
          <div className="flex flex-col gap-4">
            <div>
              <Label id="signature-mode-label">{t('mode')}</Label>
              <RadioGroup aria-labelledby="signature-mode-label" value={v.mode} onValueChange={(mode) => setV({ ...v, mode: mode as SignatureMode })} className="mt-2 gap-3">
                {MODES.map((mode) => (
                  <label key={mode} className="flex cursor-pointer items-start gap-2 text-body text-ink">
                    <RadioGroupItem value={mode} className="mt-0.5" />
                    <span className="flex flex-col">
                      {t(`modes.${mode}.label`)}
                      <span className="text-hint text-muted-ink">{t(`modes.${mode}.hint`)}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
            {v.mode === 'one' ? (
              <FormGrid>
                <FormField id="signature-non-signer" label={t('nonSigner')} required size="m" error={errors.nonSignerAuditorId}>
                  <Select id="signature-non-signer" value={v.nonSigner} onChange={(e) => setV({ ...v, nonSigner: e.target.value })}>
                    <option value="">{t('nonSignerPick')}</option>
                    {report.auditors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.contactName}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField id="signature-reason" label={t('reason')} required size="m" error={errors.nonSignerReason}>
                  <Input id="signature-reason" value={v.reason} maxLength={300} onChange={(e) => setV({ ...v, reason: e.target.value })} />
                </FormField>
              </FormGrid>
            ) : null}
          </div>
        </Section>
      </FormCardBody>
      <FormActionBar count={changed} onSave={() => void save()} onDiscard={() => setV(initial)} pending={pending} note={lastChanged(sig.updatedByUserId, sig.updatedAt)} state={withUnplacedFieldErrors(feedback.state, ['nonSignerAuditorId', 'nonSignerReason'])} saveTestId="signatures-save" />
    </FormCard>
  );
}

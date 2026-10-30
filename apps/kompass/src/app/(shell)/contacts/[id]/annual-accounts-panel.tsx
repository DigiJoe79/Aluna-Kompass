'use client';

import type { NameConsentEntry } from '@kompass/module-finance';
import { formatPercent } from '@kompass/module-finance/format';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Overline } from '@/components/overline';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { Segmented } from '@/components/ui/segmented';
import { formatEuro } from '@/lib/finance/amount';
import { saveContactTaxDetailsAction } from '../../finance/tax/actions';
import { NameConsentDialog } from './name-consent-dialog';

type LegalEntity = 'yes' | 'no' | 'unknown';
const linkClass = 'text-link underline-offset-2 hover:underline';

/**
 * Karte „Jahresrechnung“ am Kontakt (Designer 2a, neben „Umsatzsteuer“, gleicher Aufbau): bei Organisationen das Merkmal
 * „juristische Person“ (`Segmented` ja / nein / unbekannt, gespeichert über die Leiste); bei „ja“ entfällt die
 * Einwilligung — ihr Verlauf bleibt erhalten, er steht nur nicht da. Sonst die Namensnennung als eine Zeile mit dem
 * letzten Stand, der Folge fürs letzte beendete Jahr und dem Verlauf zum Aufklappen. „unbekannt“ wirkt wie „nein“.
 */
export function AnnualAccountsPanel({
  contactId,
  contactKind,
  legalEntity,
  consents,
  effect,
  canEdit,
  today,
  lastClosedYear,
}: {
  contactId: string;
  contactKind: 'person' | 'organization';
  legalEntity: 'yes' | 'no' | null;
  /** Verlauf der Einwilligung, der jüngste zuerst. */
  consents: NameConsentEntry[];
  /** Was die Jahresrechnung des letzten beendeten Jahres über den Kontakt sagt; `null` unter 10 %. */
  effect: { designation: string; amountCents: number; sharePermille: number; named: boolean } | null;
  canEdit: boolean;
  today: string;
  /** Vorgabe für „Für die Jahresrechnungen ab“. */
  lastClosedYear: number;
}) {
  const t = useTranslations('finance.contactAnnualAccounts');
  const fmt = useDateFormat();
  const router = useRouter();
  const saved: LegalEntity = legalEntity ?? 'unknown';
  const [legal, setLegal] = useState<LegalEntity>(saved);
  const [dialog, setDialog] = useState<'granted' | 'revoked' | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const organization = contactKind === 'organization';
  const count = organization && legal !== saved ? 1 : 0;

  const save = async () => {
    if (count === 0) return;
    setPending(true);
    const result = await feedback.run(() => saveContactTaxDetailsAction({ contactId, legalEntity: legal === 'unknown' ? null : legal }), { retry: () => void save() });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  const [latest, ...older] = consents;
  const stateLine = (e: NameConsentEntry) => (
    <>
      {e.kind === 'granted' ? t('granted', { date: fmt.date(e.on), year: e.fromYear ?? '' }) : t('revoked', { date: fmt.date(e.on) })}
      {e.documentId && e.documentNumber ? (
        <>
          {' · '}
          <Link href={`/dms/${e.documentId}`} className={linkClass}>
            {e.documentNumber}
          </Link>
        </>
      ) : null}
    </>
  );
  const effectValues = effect ? { year: effect.designation, amount: formatEuro(effect.amountCents), percent: formatPercent(effect.sharePermille) } : null;

  return (
    <FormCard data-testid="contact-annual-accounts">
      <FormCardBody>
        <Section title={t('title')}>
          {organization ? (
            <FormGrid>
              <FormField id="contact-legal-entity" label={t('legalEntity')} size="m">
                <Segmented<LegalEntity>
                  aria-label={t('legalEntity')}
                  value={legal}
                  disabled={!canEdit || pending}
                  onValueChange={setLegal}
                  options={[
                    { value: 'yes', label: t('yes') },
                    { value: 'no', label: t('no') },
                    { value: 'unknown', label: t('unknown') },
                  ]}
                />
              </FormField>
            </FormGrid>
          ) : null}
          {organization && legal === 'yes' ? (
            <p className="mt-3 text-meta text-ink-2">
              {t('legalEntityNamed')}
              {effectValues ? ` ${t('legalEntityEffect', effectValues)}` : null}
            </p>
          ) : (
            <div className={organization ? 'mt-4 space-y-2' : 'space-y-2'} data-testid="name-consent">
              <Overline field>{t('naming')}</Overline>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="text-body text-ink">{latest ? stateLine(latest) : t('none')}</p>
                {canEdit ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setDialog(latest?.kind === 'granted' ? 'revoked' : 'granted')}>
                    {latest?.kind === 'granted' ? t('revoke') : t('grant')}
                  </Button>
                ) : null}
              </div>
              {effect && effectValues ? (
                <p className="text-meta text-muted-ink" data-testid="annual-accounts-effect" data-named={effect.named}>
                  {t(effect.named ? 'effectNamed' : 'effectUnnamed', effectValues)}
                </p>
              ) : null}
              {older.length > 0 ? (
                <Disclosure label={t('history')} count={older.length} bounded={false}>
                  <ul className="space-y-1">
                    {older.map((e) => (
                      <li key={e.id} className="text-meta text-ink-2">
                        {stateLine(e)}
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              ) : null}
            </div>
          )}
        </Section>
      </FormCardBody>
      {organization && canEdit ? (
        <FormActionBar
          count={count}
          pending={pending}
          saveTestId="contact-annual-accounts-save"
          state={feedback.state}
          onDiscard={() => {
            setLegal(saved);
            feedback.reset();
          }}
          onSave={() => void save()}
        />
      ) : null}
      {canEdit ? <NameConsentDialog open={dialog !== null} onOpenChange={(o) => (o ? undefined : setDialog(null))} contactId={contactId} contactKind={contactKind} kind={dialog ?? 'granted'} today={today} lastClosedYear={lastClosedYear} /> : null}
    </FormCard>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import type { MutableRefObject } from 'react';
import type { RawTransactionView, SuggestionView } from '@kompass/module-finance';
import type { SplitRowCategoryOption, SplitRowOption } from '@/components/finance/split-row';
import { formatEuro } from '@/lib/finance/amount';
import type { ForeignReturnOption } from './foreign-dialog';
import type { RuleDialogOptions } from './rule-dialog';
import { SuggestionCard } from './suggestion-card';
import type { VoucherTypeOption } from './voucher-panel';

/** Was der Server zum gewählten Kontoumsatz liefert — Namen schon aufgelöst, Gründe schon als Sätze. */
export interface WorkDetailData {
  raw: RawTransactionView & { accountName: string };
  suggestion:
    | (Pick<SuggestionView, 'kind' | 'confidence' | 'draft' | 'linkEntry' | 'problems' | 'hints'> & {
        reasonTexts: string[];
        /** Weitere Geldzeilen (Umbuchung, Kasse) und Begleichungen als Satz — die Mini-Maske zeigt sie, ändert sie nicht. */
        extraLineTexts: string[];
      })
    | null;
  contactNames: Record<string, string>;
  /** Aus der Karte „Aus der Rechnung“ (`?voucher=`): nach dem Übernehmen kommen ihre Angaben und das PDF an den Entwurf. */
  pendingInvoice: { documentId: string; number: string; seller: string } | null;
  /** Nur bei einem Ausgang: frühere Eingänge fremden Gelds, die er zurückzahlen kann. */
  foreignReturnOptions: ForeignReturnOption[];
}

/** Auswahllisten der Mini-Maske — dieselben wie in der vollen Maske. */
export interface WorkFormOptions {
  categories: SplitRowCategoryOption[];
  /** Auch stillgelegte — für die Lese-Ansicht ohne Schreibrecht. */
  categoryNames: Record<string, string>;
  purposes: SplitRowOption[];
  projects: SplitRowOption[];
  taxCodeOptions: string[];
  showTax: boolean;
  /** Auswahllisten des Regel-Dialogs. */
  rule: RuleDialogOptions;
  /** Die Arten aus `finance.voucherTypes` mit ihrem Namen. */
  voucherTypes: VoucherTypeOption[];
  canCreateContact: boolean;
  /** Wer `contacts.manage` vergeben kann — für den Hinweis ohne Recht. */
  contactGrantNames: string[];
}

/** Die rechte Seite (420 px): der Kontoumsatz im Klartext mit allen Bankfeldern, darunter sein Vorschlag. */
export function WorkDetail({
  detail,
  canWrite,
  form,
  acceptRef,
  onDone,
  onSkip,
  onReload,
}: {
  detail: WorkDetailData | null;
  canWrite: boolean;
  form: WorkFormOptions;
  acceptRef: MutableRefObject<(() => void) | null>;
  onDone: (rawId: string) => void;
  onSkip: () => void;
  onReload: () => void;
}) {
  const t = useTranslations('finance.work.detail');
  if (!detail) {
    acceptRef.current = null;
    return (
      <aside data-testid="work-detail" aria-label={t('label')} className="w-full shrink-0 rounded-md border border-line bg-surface p-4 text-[13px] text-muted-ink lg:w-[420px]">
        {t('loading')}
      </aside>
    );
  }
  const raw = detail.raw;
  const fields: [string, string | null][] = [
    ['account', raw.accountName],
    ['bookingDate', raw.bookingDate],
    ['valueDate', raw.valueDate],
    ['amount', formatEuro(raw.amountCents)],
    ['counterparty', raw.counterpartyName],
    ['iban', raw.counterpartyIban],
    ['purpose', raw.purpose],
    ['bankReference', raw.bankReference],
    ['endToEndId', raw.endToEndId],
    ['returnCode', raw.returnCode],
  ];

  return (
    <aside data-testid="work-detail" aria-label={t('label')} className="w-full shrink-0 space-y-4 lg:w-[420px]">
      <section className="rounded-md border border-line bg-surface p-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          {fields
            .filter(([, value]) => value !== null && value !== '')
            .map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-ink">{t(`fields.${key}`)}</dt>
                <dd className={key === 'iban' || key === 'bankReference' || key === 'endToEndId' || key === 'bookingDate' || key === 'valueDate' || key === 'amount' ? 'break-all font-mono tabular-nums text-ink' : 'text-ink'}>{value}</dd>
              </div>
            ))}
        </dl>
      </section>
      <SuggestionCard key={`${raw.id}-${detail.suggestion?.kind ?? 'none'}`} detail={detail} canWrite={canWrite} form={form} acceptRef={acceptRef} onDone={onDone} onSkip={onSkip} onReload={onReload} />
    </aside>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import type { MutableRefObject } from 'react';
import type { RawTransactionView, SuggestionView } from '@kompass/module-finance';
import { useDateFormat } from '@/components/date-format-provider';
import type { SplitRowCategoryOption, SplitRowOption } from '@/components/finance/split-row';
import { formatEuro } from '@/lib/finance/amount';
import type { ForeignReturnOption } from './foreign-dialog';
import type { RuleDialogOptions } from './rule-dialog';
import { SuggestionCard } from './suggestion-card';
import type { VoucherTypeOption } from './voucher-panel';
import type { WorkPartnerOption } from './partner-payment-dialog';
import { formatIban } from '@kompass/module-finance/format';

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
  /** Aktive Partner für „Als Zahlung an Partner erfassen“ (Task 5 Design-Nachtrag Phase 4). */
  partners: WorkPartnerOption[];
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
  const { date } = useDateFormat();
  if (!detail) {
    acceptRef.current = null;
    return (
      <aside data-testid="work-detail" aria-label={t('label')} className="w-full shrink-0 rounded-md border border-line bg-surface p-4 text-meta text-muted-ink @min-[48rem]:w-[360px] @min-[64rem]:w-[420px]">
        {t('loading')}
      </aside>
    );
  }
  const raw = detail.raw;
  const fields: [string, string | null][] = [
    ['account', raw.accountName],
    ['bookingDate', date(raw.bookingDate)],
    ['valueDate', raw.valueDate ? date(raw.valueDate) : null],
    ['amount', formatEuro(raw.amountCents)],
    ['counterparty', raw.counterpartyName],
    ['iban', raw.counterpartyIban ? formatIban(raw.counterpartyIban) : null],
    ['email', raw.counterpartyEmail],
    ['purpose', raw.purpose],
    ['bankReference', raw.bankReference],
    ['endToEndId', raw.endToEndId],
    ['relatedReference', raw.relatedReference],
    ['returnCode', raw.returnCode],
  ];

  return (
    <aside data-testid="work-detail" aria-label={t('label')} className="w-full shrink-0 space-y-4 @min-[48rem]:w-[360px] @min-[64rem]:w-[420px]">
      <section className="rounded-md border border-line bg-surface p-4">
        {/* Runde 3, 064: Unter `md` steht der Wert unter der Bezeichnung, damit lange Werte (IBAN, Verwendungszweck) die
            ganze Breite haben; die IBAN bricht nur zwischen ihren Gruppen (`formatIban`, kein `break-all`). Layout an
            einer Stelle, ohne dauerhaften Test (Projektregel). Die Spalte der Bezeichnungen ist fest breit: Mit `auto`
            folgte sie der längsten Bezeichnung des gewählten Umsatzes (nur manche tragen „Ende-zu-Ende-Referenz“), und
            die Werte sprangen beim Wechsel der Zeile hin und her (Joe 2026-10-17). */}
        <dl className="grid grid-cols-1 gap-y-2 text-meta md:grid-cols-[9rem_minmax(0,1fr)] md:gap-x-3 md:gap-y-1">
          {fields
            .filter(([, value]) => value !== null && value !== '')
            .map(([key, value]) => (
              <div key={key} className="md:contents">
                <dt className="text-muted-ink">{t(`fields.${key}`)}</dt>
                <dd className={key === 'iban' || key === 'bankReference' || key === 'endToEndId' || key === 'relatedReference' ? `${key === 'iban' ? '' : 'break-all '}font-mono text-ink` : key === 'bookingDate' || key === 'valueDate' || key === 'amount' ? 'tabular-nums text-ink' : 'text-ink'}>{value}</dd>
              </div>
            ))}
        </dl>
      </section>
      <SuggestionCard key={`${raw.id}-${detail.suggestion?.kind ?? 'none'}`} detail={detail} canWrite={canWrite} form={form} acceptRef={acceptRef} onDone={onDone} onSkip={onSkip} onReload={onReload} />
    </aside>
  );
}

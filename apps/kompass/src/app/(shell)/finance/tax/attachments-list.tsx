'use client';

import type { TaxPeriodView, TaxReturnView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { reportQuery } from '@/lib/finance/report-params';
import { TaxDocumentDialog } from './tax-document-dialog';
import type { TaxMe } from './types';

type Attachment = TaxReturnView['attachments'][number];
/** Die Beilagen, die ein Dokument am Zeitraum sind (Platz gleich Schlüssel). */
type DocumentSlot = 'activityReport' | 'statute';
const DOCUMENT_SLOTS: readonly string[] = ['activityReport', 'statute'] satisfies DocumentSlot[];

const linkClass = 'text-meta text-link underline-offset-2 hover:underline';

/**
 * Die Beilagen (Board 5a, 16d): eine Karte, je Beilage eine Zeile der `RequirementList` (`variant="rows"`) — Berichte mit ihrer Stufe als Satz und einem
 * Link auf den Bericht (festgeschrieben gilt als erledigt), Tätigkeitsbericht und Satzung mit „Ablegen …“, das Protokoll der
 * Mitgliederversammlung mit dem Weg zu Schritt 11 des Jahresabschlusses, wo es abgelegt wird.
 */
export function AttachmentsList({ attachments, periodId, periodLabel = '', designations, documents, me }: { attachments: readonly Attachment[]; periodId: string; /** Für Beilagen über den ganzen Zeitraum: alle Namen mit Jahr (Designer Runde 7, 16d). */ periodLabel?: string; designations: Record<string, string>; documents: TaxPeriodView['documents']; me: TaxMe }) {
  const t = useTranslations('finance.tax.attachments');
  const tTax = useTranslations('finance.tax');
  const [filing, setFiling] = useState<DocumentSlot | null>(null);

  const item = (a: Attachment, i: number): RequirementListItem => {
    const year = a.fiscalYearId ? (designations[a.fiscalYearId] ?? '') : periodLabel;
    const done = a.state === 'final' || a.state === 'present';
    const isReport = a.state === 'preliminary' || a.state === 'review' || a.state === 'final';
    // Der Rücklagenspiegel über die Jahre des Zeitraums: die Seite versteht `?period=` (Befund 18 d) — dieselbe Fassung,
    // deren Stufe hier steht.
    let extra: React.ReactNode = undefined;
    if (isReport && a.params) {
      extra = (
        <Link href={`/finance/reports/${a.key}?${reportQuery(a.params, { periodId })}`} className={linkClass} data-testid={`tax-attachment-${a.key}-link`}>
          {t('open')}
        </Link>
      );
    } else if (DOCUMENT_SLOTS.includes(a.key)) {
      const slot = a.key as DocumentSlot;
      const doc = documents[slot];
      extra = doc ? (
        <Link href={`/dms/${doc.documentId}`} className={linkClass}>
          {doc.documentNumber}
        </Link>
      ) : me.canEdit ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setFiling(slot)} data-testid={`tax-file-${slot}`}>
          {tTax('filing.file')}
        </Button>
      ) : undefined;
    } else if (a.key === 'assemblyMinutes' && !done && a.fiscalYearId) {
      extra = (
        <Link href={`/finance/closing?year=${encodeURIComponent(a.fiscalYearId)}#step-assembly`} className={linkClass}>
          {t('toAssembly')}
        </Link>
      );
    }
    return {
      key: `${a.key}-${a.fiscalYearId ?? i}`,
      title: t(`keys.${a.key}`, { year }),
      done,
      blocked: false,
      detail: isReport ? t(`stage.${a.state}`) : a.key === 'statute' ? t('statuteDetail') : a.state === 'missing' ? t('missing') : undefined,
      canSelf: me.canEdit,
      canDoNames: [],
      canDoText: '',
      href: null,
      actionLabel: tTax('filing.file'),
      doneLabel: tTax('done'),
      extra,
    };
  };

  return (
    // Eine Karte mit Zeilen statt sechs Karten (Designer Runde 7, 16d).
    <FormCard as="section">
      <FormCardBody>
        <Section title={t('title')} intro={t('intro')}>
          <div data-testid="tax-attachments">
            <RequirementList variant="rows" items={attachments.map(item)} />
          </div>
        </Section>
      </FormCardBody>
      {filing ? <TaxDocumentDialog open onOpenChange={(o) => (o ? undefined : setFiling(null))} periodId={periodId} slot={filing} canPickDocument={me.canPickDocument} /> : null}
    </FormCard>
  );
}

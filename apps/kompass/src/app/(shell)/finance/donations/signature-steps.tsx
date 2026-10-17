'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { Steps } from '@/components/steps';
import { formatEuro } from '@/lib/finance/amount';
import { attachSignedAction } from './actions';

export interface NeedsSignatureRow {
  id: string;
  number: string;
  issuedOn: string;
  contactName: string;
  totalCents: number;
  signed: boolean;
}

/**
 * „Unterschrift fehlt“ (C1): 1 erzeugt · 2 drucken und unterschreiben (unser
 * Exemplar) · 3 als Eingang ablegen — das Verknüpfen geschieht dabei von selbst
 * und ist kein eigener Schritt, der Hinweis am Schritt 3 nennt es (Runde 3, 204). Je
 * Bestätigung ein Block mit `Steps density="compact"` (Entwurf E3); Schritt 3
 * nimmt das PDF an und verknüpft es über `attachSignedConfirmation` — ohne
 * Ordnerwahl, als eigenes Dokument der Akte, verknüpft mit der Bestätigung.
 */
export function SignatureSteps({ rows, canIssue }: { rows: NeedsSignatureRow[]; canIssue: boolean }) {
  const t = useTranslations('finance.donations.signature');
  if (rows.length === 0) return <EmptyState title={t('empty.title')} text={t('empty.text')} />;
  return (
    <ul className="divide-y divide-line-2 rounded-lg border border-line bg-surface">
      {rows.map((row) => (
        <SignatureCard key={row.id} row={row} canIssue={canIssue} />
      ))}
    </ul>
  );
}

function SignatureCard({ row, canIssue }: { row: NeedsSignatureRow; canIssue: boolean }) {
  const t = useTranslations('finance.donations.signature');
  const { date } = useDateFormat();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setPending(true);
    const formData = new FormData();
    formData.append('id', row.id);
    formData.append('file', file);
    const result = await feedback.run(() => attachSignedAction(formData), { retry: () => void upload(files) });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  // Kompakt (Entwurf E3, 14 B7): ein Block je Bestätigung in einer gerahmten Liste, die Schritte als Zeilen. Ob schon
  // gedruckt wurde, weiß Kompass nicht; die Ablagefläche steht deshalb am Schritt „ablegen“, solange er offen ist.
  const state = (done: boolean, active = false) => (done ? 'done' : active ? 'active' : 'todo') as 'done' | 'active' | 'todo';
  return (
    <li data-testid="signature-steps" className="flex flex-col gap-2.5 p-4">
      <p className="flex items-baseline gap-2 text-body text-ink">
        <Link href={`/finance/donations?confirmation=${row.id}`} className="font-mono text-link underline-offset-2 hover:underline">
          {row.number}
        </Link>
        <span className="min-w-0">{row.contactName}</span>
        <span className="ml-auto shrink-0 tabular-nums">{formatEuro(row.totalCents)}</span>
      </p>
      <Steps
        density="compact"
        testId={`signature-${row.id}`}
        steps={[
          { key: 'created', label: t('steps.created'), state: 'done', detail: date(row.issuedOn) },
          {
            key: 'print',
            label: t('steps.print'),
            state: state(row.signed, true),
            action: row.signed ? undefined : (
              <a href={`/finance/donations/${row.id}/copy`} target="_blank" rel="noreferrer" className="text-link underline underline-offset-2">
                {t('steps.printAction')}
              </a>
            ),
          },
          {
            key: 'upload',
            label: t('steps.upload'),
            state: state(row.signed),
            below:
              canIssue && !row.signed ? (
                <div className="flex max-w-md flex-col gap-1.5">
                  <RefusalNotice action state={feedback.state} />
                  <ReceiptDrop onFiles={(files) => void upload(files)} disabled={pending} />
                  <p className="text-hint text-muted-ink">{t('steps.uploadHint', { number: row.number })}</p>
                </div>
              ) : undefined,
          },
        ]}
      />
    </li>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { RequirementList } from '@/components/requirement-list';
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
 * „Unterschrift fehlt“ (C1, Vierschritt): 1 erzeugt · 2 drucken und
 * unterschreiben (unser Exemplar) · 3 als Eingang ablegen · 4 verknüpft. Je
 * Bestätigung eine Checkliste im Muster von `RequirementList`; Schritt 3
 * nimmt das PDF an und verknüpft es über `attachSignedConfirmation`.
 */
export function SignatureSteps({ rows, canIssue }: { rows: NeedsSignatureRow[]; canIssue: boolean }) {
  const t = useTranslations('finance.donations.signature');
  if (rows.length === 0) return <EmptyState title={t('empty.title')} text={t('empty.text')} />;
  return (
    <ul className="space-y-4">
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

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setPending(true);
    const result = await attachSignedAction(row.id, file.name, new Uint8Array(await file.arrayBuffer()));
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.message) toast.success(result.message);
      router.refresh();
    }
  };

  const common = { blocked: false, canDoNames: [], canDoText: '', doneLabel: t('done') };
  return (
    <li data-testid="signature-steps" className="space-y-3 rounded-md border border-line bg-surface p-4">
      <p className="text-[14px] text-ink">
        <span className="font-mono font-semibold">{row.number}</span> · {row.contactName} · <span className="font-mono tabular-nums">{formatEuro(row.totalCents)}</span> ·{' '}
        <span className="text-ink-2">{date(row.issuedOn)}</span>
      </p>
      <RequirementList
        items={[
          { ...common, key: 'created', title: t('steps.created'), done: true, canSelf: false, href: '', actionLabel: '' },
          { ...common, key: 'print', title: t('steps.print'), done: row.signed, detail: t('steps.printHint'), canSelf: !row.signed, href: `/finance/donations/${row.id}/copy`, actionLabel: t('steps.printAction') },
          {
            ...common,
            key: 'upload',
            title: t('steps.upload'),
            done: row.signed,
            canSelf: false,
            href: '',
            actionLabel: t('open'),
            extra: canIssue && !row.signed ? <div className="w-72"><ReceiptDrop onFiles={(files) => void upload(files)} disabled={pending} /></div> : undefined,
          },
          { ...common, key: 'linked', title: t('steps.linked'), done: row.signed, canSelf: false, href: '', actionLabel: t('open') },
        ]}
      />
    </li>
  );
}

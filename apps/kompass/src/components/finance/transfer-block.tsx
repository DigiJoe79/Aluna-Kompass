'use client';

import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/clipboard';
import { formatEuro } from '@/lib/finance/amount';

function CopyField({ label, value }: { label: string; value: string }) {
  const c = useTranslations('common');
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line-2 py-1.5 last:border-0">
      <div className="min-w-0">
        <p className="text-[11px] text-muted-ink">{label}</p>
        <p className="truncate text-[13px] text-ink">{value}</p>
      </div>
      <button
        type="button"
        aria-label={`${c('copy')}: ${label}`}
        onClick={async () => {
          if (await copyToClipboard(value)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } else toast.error(c('copyFailed'));
        }}
        className="flex shrink-0 items-center gap-1.5 rounded-sm border border-line px-2 py-1 text-[12px] text-ink-2 hover:bg-hover"
      >
        <Copy className="size-3.5" aria-hidden />
        {copied ? c('copied') : c('copy')}
      </button>
    </div>
  );
}

/**
 * Der Überweisungsblock ohne IBAN (HANDOFF § 5.5, Task 3 — die IBAN kommt mit
 * F5/F8a): Empfänger, Betrag, Verwendungszweck je mit Kopierknopf; statt eines
 * QR-Codes der Satz, dass hier noch keine Bankverbindung hinterlegt ist.
 */
export function TransferBlock({ recipient, amountCents, reference }: { recipient: string; amountCents: number; reference: string }) {
  const t = useTranslations('finance.openItems.transferBlock');
  return (
    <div className="space-y-1 rounded-md border border-line bg-surface-2 p-3">
      <CopyField label={t('recipient')} value={recipient} />
      <CopyField label={t('amount')} value={formatEuro(amountCents)} />
      <CopyField label={t('reference')} value={reference} />
      <p className="pt-2 text-[12px] text-muted-ink">{t('noIban')}</p>
    </div>
  );
}

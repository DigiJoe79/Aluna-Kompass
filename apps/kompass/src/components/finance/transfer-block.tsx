'use client';

import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { QrCode } from '@/components/ui/qr-code';
import { copyToClipboard } from '@/lib/clipboard';
import { formatEuro } from '@/lib/finance/amount';
import { groupIban } from '@/lib/finance/iban-check';
import { cn } from '@/lib/utils';

/** Kante des QR-Codes (Plan N5 Annahme 2, Review Focus 4). */
const QR_SIZE = 160;

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
 * Der Überweisungsblock (HANDOFF § 5.5): Empfänger, IBAN, Betrag,
 * Verwendungszweck je mit Kopierknopf. Ohne bekannte IBAN (offene Posten von
 * Hand) steht statt ihrer der Satz, dass keine Bankverbindung hinterlegt ist;
 * die Erstattung einer Auslage (F8a) bringt die IBAN des Antrags mit.
 *
 * N5: Ist eine EPC-QR-Nutzlast da (der Server-Teil berechnet sie mit
 * `epcQrPayload`, nie dieser Client-Baustein — Client-Import-Wächter), zeigt
 * der Baustein daneben den QR-Code („GiroCode“) zum Scannen mit der
 * Banking-App. Ab `md` steht er rechts neben den Feldern, darunter unter
 * ihnen (Review Focus 4).
 */
export function TransferBlock({
  recipient,
  amountCents,
  reference,
  iban,
  epcPayload,
}: {
  recipient: string;
  amountCents: number;
  reference: string;
  iban?: string | null;
  epcPayload?: string | null;
}) {
  const t = useTranslations('finance.openItems.transferBlock');
  return (
    <div data-testid="transfer-block" className={cn('rounded-md border border-line bg-surface-2 p-3', epcPayload && 'flex flex-col gap-3 md:flex-row md:items-start md:justify-between')}>
      <div className="min-w-0 flex-1 space-y-1">
        <CopyField label={t('recipient')} value={recipient} />
        {iban ? <CopyField label={t('iban')} value={groupIban(iban)} /> : null}
        <CopyField label={t('amount')} value={formatEuro(amountCents)} />
        <CopyField label={t('reference')} value={reference} />
        {iban ? null : <p className="pt-2 text-[12px] text-muted-ink">{t('noIban')}</p>}
      </div>
      {epcPayload ? (
        <figure data-testid="transfer-qr" className="flex flex-col items-center gap-1.5 self-center md:shrink-0 md:self-start">
          <QrCode payload={epcPayload} size={QR_SIZE} label={t('qrAlt', { recipient })} />
          <figcaption className="text-[11px] text-muted-ink">{t('qrCaption')}</figcaption>
        </figure>
      ) : null}
    </div>
  );
}

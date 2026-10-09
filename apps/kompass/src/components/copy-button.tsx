'use client';

import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/clipboard';

/**
 * Kopier-Knopf für einen Wert, den man weitergibt (IBAN, Verwendungszweck, die technische Aktion im Protokoll).
 * Zeigt zwei Sekunden „Kopiert“; scheitert das Gerät, sagt es ein Toast mit Schließen-Knopf (MUSTER § A,
 * Gerätefehler). Herausgelöst aus dem Überweisungsblock (Designer 2026-10-09).
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const c = useTranslations('common');
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`${c('copy')}: ${label}`}
      onClick={async () => {
        if (await copyToClipboard(value)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } else toast.error(c('copyFailed'), { duration: Infinity, closeButton: true });
      }}
      className="flex shrink-0 items-center gap-1.5 rounded-sm border border-line px-2 py-1 text-[12px] text-ink-2 hover:bg-hover"
    >
      <Copy className="size-3.5" aria-hidden />
      {copied ? c('copied') : c('copy')}
    </button>
  );
}

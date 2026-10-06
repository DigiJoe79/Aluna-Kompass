'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ActionState } from '@/lib/actions';
import { toastNetwork } from '@/lib/feedback';

/** Der Dateiname aus `Content-Disposition`: erst `filename*` (UTF-8, RFC 5987), dann `filename`, sonst der Rückfall. */
export function filenameFrom(disposition: string | null, fallback: string): string {
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? '')?.[1];
  if (utf8) return decodeURIComponent(utf8);
  return /filename="([^"]+)"/.exec(disposition ?? '')?.[1] ?? fallback;
}

/**
 * Herunterladen nach MUSTER A, wie Backup- und Akten-Export: Eine Ablehnung
 * des Dienstes landet als `refusal` für die `RefusalNotice` über dem Knopf;
 * ist der Server nicht zu erreichen, bleibt ein Toast mit „Erneut versuchen“.
 */
export function useFileDownload(messages: { forbidden: string; notFound: string; failed: string }) {
  const tCommon = useTranslations('common');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<ActionState>({ status: 'idle' });

  const download = async (href: string, fallbackName: string): Promise<void> => {
    setBusy(true);
    setRefusal({ status: 'idle' });
    try {
      const res = await fetch(href);
      if (!res.ok) {
        const message = res.status === 403 ? messages.forbidden : res.status === 404 ? messages.notFound : messages.failed;
        setRefusal({ status: 'error', message, fieldErrors: {} });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: filenameFrom(res.headers.get('content-disposition'), fallbackName) });
      // Der Anker muss im Dokument hängen: ein Klick auf ein losgelöstes
      // Element löst in Safari und Firefox keinen Download aus.
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      // Der Server war nicht zu erreichen: keine Ablehnung, sondern ein Toast zum Wiederholen.
      toastNetwork({ status: 'error', kind: 'network', message: tCommon('network'), fieldErrors: {} }, tCommon('retry'), () => void download(href, fallbackName));
    } finally {
      setBusy(false);
    }
  };

  return { busy, refusal, download };
}

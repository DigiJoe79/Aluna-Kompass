'use client';

import type { VoucherSearchHit } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import type { BookFromTransactionInput } from '@/lib/finance/work';
import { linkVoucherAction, searchVouchersAction, uploadVoucherToTransactionAction } from './actions';

export interface VoucherTypeOption {
  key: string;
  label: string;
}

/**
 * Beleg von beiden Seiten (F5 Task 8, Spec 6.5): ein PDF auf den Umsatz
 * ziehen — kurzer Bestätigungsschritt, dann legt der Dienst es im Namen der
 * Buchung ab — oder „Beleg suchen“: Treffer der Akte mit „Verknüpfen“ und
 * dem Weg in die Akte selbst.
 */
export function VoucherPanel({
  raw,
  voucherTypes,
  draftForLink,
  entryTextIfNew,
  onDone,
}: {
  raw: { id: string; bookingDate: string; amountCents: number };
  voucherTypes: VoucherTypeOption[];
  /** Der Entwurf, der entsteht, wenn am Umsatz noch keiner hängt — aus der Mini-Maske. */
  draftForLink: () => Omit<BookFromTransactionInput, 'reviewed'>;
  entryTextIfNew: string;
  onDone: (rawId: string) => void;
}) {
  const t = useTranslations('finance.work.voucher');
  const preferred = raw.amountCents < 0 ? 'voucher-invoice' : 'voucher-receipt';
  const defaultType = voucherTypes.find((v) => v.key === preferred)?.key ?? voucherTypes[0]?.key ?? '';
  const [file, setFile] = useState<File | null>(null);
  const [typeKey, setTypeKey] = useState(defaultType);
  const [documentDate, setDocumentDate] = useState(raw.bookingDate);
  const [title, setTitle] = useState('');
  const [search, setSearch] = useState<{ state: 'idle' } | { state: 'loading' } | { state: 'ready'; hits: VoucherSearchHit[]; queries: string[] } | { state: 'failed' }>({ state: 'idle' });
  const [refusal, setRefusal] = useState<Extract<ActionState, { status: 'error' }> | null>(null);
  const [pending, startTransition] = useTransition();

  const finish = (result: ActionState) => {
    if (result.status === 'error') {
      setRefusal(result);
      toast.error(result.message);
      return;
    }
    if (result.status === 'success' && result.message) toast.success(result.message);
    setRefusal(null);
    setFile(null);
    onDone(raw.id);
  };

  const upload = () => {
    if (!file) return;
    startTransition(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      finish(await uploadVoucherToTransactionAction({ rawTransactionId: raw.id, typeKey, documentDate, title: title.trim() || undefined, entryTextIfNew: entryTextIfNew.trim() || undefined, bytes }));
    });
  };

  const runSearch = () => {
    setSearch({ state: 'loading' });
    void searchVouchersAction(raw.id).then((result) => setSearch(result ? { state: 'ready', ...result } : { state: 'failed' }));
  };

  const link = (documentId: string) => startTransition(async () => finish(await linkVoucherAction(raw.id, documentId, draftForLink())));

  const matched = (hit: VoucherSearchHit) => hit.matchedBy.map((by) => (by === 'amount' ? t('matchedAmount') : t('matchedCounterparty'))).join(', ');

  return (
    <section aria-label={t('title')} className="space-y-3 rounded-md border border-line bg-surface p-4">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{t('title')}</h3>
      {file ? (
        <div role="group" aria-label={t('confirm')} className="space-y-3 rounded-md border border-line bg-surface-2 p-3 text-[13px]">
          <p className="text-ink-2">{t('file', { name: file.name })}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="voucher-type">{t('type')}</Label>
              <Select id="voucher-type" value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
                {voucherTypes.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="voucher-date">{t('date')}</Label>
              <Input id="voucher-date" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="voucher-title">{t('titleField')}</Label>
            <Input id="voucher-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <p className="text-[12px] text-muted-ink">{t('titleHint')}</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={upload} disabled={pending}>
              {t('confirm')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setFile(null)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <ReceiptDrop onFiles={(files) => setFile(files[0] ?? null)} disabled={pending} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={runSearch} disabled={search.state === 'loading'}>
          {t('search')}
        </Button>
        {search.state === 'ready' && search.queries[0] ? (
          <Link href={`/dms?text=${encodeURIComponent(search.queries[0])}`} className="text-[13px] font-semibold underline underline-offset-2">
            {t('searchArchive')}
          </Link>
        ) : null}
      </div>
      {search.state === 'loading' ? <p className="text-[13px] text-muted-ink">{t('searching')}</p> : null}
      {search.state === 'ready' ? (
        search.hits.length === 0 ? (
          <p className="text-[13px] text-muted-ink">{t('noHits')}</p>
        ) : (
          <ul aria-label={t('hitsLabel')} className="divide-y divide-line-2 rounded-md border border-line">
            {search.hits.map((hit) => (
              <li key={hit.documentId} className="flex items-start gap-2 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block font-semibold text-ink">{hit.subject}</span>
                  <span className="block font-mono text-[12px] text-ink-2">
                    {hit.number} · {hit.documentDate}
                  </span>
                  <span className="block text-[12px] text-muted-ink">{t('matchedBy', { what: matched(hit) })}</span>
                </span>
                <Button type="button" size="sm" onClick={() => link(hit.documentId)} disabled={pending}>
                  {t('link')}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {refusal ? <Notice level="refuse">{refusal.detail ?? refusal.message}</Notice> : null}
    </section>
  );
}

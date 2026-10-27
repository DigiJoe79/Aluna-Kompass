'use client';

import type { HandoverView } from '@kompass/module-finance';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Overline } from '@/components/overline';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatEuro } from '@/lib/finance/amount';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { useFileDownload } from '@/lib/use-file-download';
import { fileProtocolAction, saveHandoverItemsAction, type HandoverItemInput } from './actions';

type Item = HandoverItemInput & { draftKey: string };

const toItems = (h: HandoverView): Item[] => h.items.map((i) => ({ id: i.id, key: i.key, label: i.label, note: i.note ?? '', checked: i.checked, draftKey: i.id }));

/**
 * Schritt 3 „Übergabeprotokoll“ (Board 13e, 14c): je Punkt ein Kästchen; das Notizfeld erst nach „Notiz hinzufügen“
 * (wie „Antworten“ in 9b), eine gespeicherte Notiz steht als Text darunter. „Weiteren Punkt hinzufügen“, die
 * Speicherleiste ohne Fläche am Ende des Schritts (Runde 6) mit „Speichern“ (primär nur mit Änderungen, sonst `outline`
 * und gesperrt), „Zum Unterschreiben drucken“ (`outline`) und „Scan ablegen …“ — `outline`, bis alle Punkte abgehakt und
 * gespeichert sind, dann primär: nie zwei primäre Knöpfe zugleich (15a).
 */
export function HandoverItems({ handover: h, canManage }: { handover: HandoverView; canManage: boolean }) {
  const t = useTranslations('finance.closing.handover.protocol');
  const fmt = useDateFormat();
  const router = useRouter();
  const initial = toItems(h);
  const [items, setItems] = useState<Item[]>(initial);
  const [pending, setPending] = useState(false);
  const [scanning, setScanning] = useState(false);
  /** Punkte, deren Notizfeld aufgeklappt ist. */
  const [noting, setNoting] = useState<ReadonlySet<string>>(new Set());
  const feedback = useActionFeedback();
  const file = useFileDownload({ forbidden: t('downloadRefused.forbidden'), notFound: t('downloadRefused.notFound'), failed: t('downloadRefused.failed') });

  useEffect(() => {
    setItems(toItems(h));
    setNoting(new Set());
  }, [h]);

  const changed = items.length - initial.length + items.filter((i) => {
    const before = initial.find((b) => b.draftKey === i.draftKey);
    return before && (before.checked !== i.checked || (before.note ?? '') !== (i.note ?? '') || (before.label ?? '') !== (i.label ?? ''));
  }).length;

  const update = (draftKey: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.draftKey === draftKey ? { ...i, ...patch } : i)));
  const save = async () => {
    setPending(true);
    const payload = items.map(({ draftKey: _d, ...i }) => ({ ...i, note: i.note?.trim() ? i.note.trim() : null, label: i.key === 'custom' ? (i.label?.trim() ?? '') : null }));
    const result = await feedback.run(() => saveHandoverItemsAction(h.id, payload, h.version), { retry: () => void save() });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  const hintOf = (i: Item) => {
    if (i.key === 'custom') return null;
    const counted = h.cashAccounts.filter((a) => a.count !== null);
    if (i.key === 'cash' && counted.length > 0) return t('cashAmount', { amounts: counted.map((a) => t('cashBox', { name: a.name, amount: formatEuro(a.count!.countedCents) })).join(', '), date: fmt.date(h.handoverOn) });
    return t(`itemHints.${i.key}`);
  };

  const savedNote = (i: Item) => (i.id ? (h.items.find((x) => x.id === i.id)?.note ?? null) : null);
  // Alle Punkte abgehakt und gespeichert: Jetzt ist „Scan ablegen …“ die Hauptsache (14c).
  const ready = changed === 0 && items.length > 0 && items.every((i) => i.checked);

  const print = (
    <Button type="button" variant="outline" disabled={file.busy || changed > 0} onClick={() => void file.download(`/finance/closing/handover/${encodeURIComponent(h.id)}/protocol`, `Uebergabeprotokoll-${h.handoverOn}.pdf`)} data-testid="handover-print">
      {t('print')}
    </Button>
  );
  const scan = (
    <Button type="button" variant={ready ? 'default' : 'outline'} onClick={() => setScanning(true)} data-testid="handover-scan">
      {t('scan')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="handover-protocol">
      <p className="text-meta text-ink-2">{t('intro')}</p>
      {/* Runde 6, Antwort 1: keine eigene Karte — die Felder stehen im Schritt, die Leiste ohne Fläche an seinem Ende. */}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          void save();
        }}
      >
        <div>
          {/* Ohne Overline (Runde 6, 15a): Der Satz darüber sagt, was übergeben wird; im Schritt gibt es nur eine Gruppe. */}
          <ul aria-label={t('items')} className="flex flex-col gap-3" data-testid="handover-items">
            {items.map((i) => (
              <li key={i.draftKey} className="flex flex-wrap items-start gap-x-3 gap-y-1.5" data-testid="handover-item">
                <Checkbox id={`handover-item-${i.draftKey}`} checked={i.checked} disabled={!canManage} onCheckedChange={(v) => update(i.draftKey, { checked: v === true })} className="mt-2" aria-label={i.key === 'custom' ? (i.label ?? t('customLabel')) : t(`itemKeys.${i.key}`)} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  {i.key === 'custom' ? (
                    <Input value={i.label ?? ''} onChange={(e) => update(i.draftKey, { label: e.target.value })} aria-label={t('customLabel')} disabled={!canManage} />
                  ) : (
                    <label htmlFor={`handover-item-${i.draftKey}`} className="mt-1.5 text-body text-ink">
                      {t(`itemKeys.${i.key}`)}
                    </label>
                  )}
                  {hintOf(i) ? (
                    <span className="text-hint text-muted-ink">
                      {hintOf(i)}
                      {i.key === 'kompass' ? (
                        <>
                          {' · '}
                          <Link href="/admin/users" className="text-link underline-offset-2 hover:underline">
                            {t('users')}
                          </Link>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                  {noting.has(i.draftKey) ? (
                    <Input value={i.note ?? ''} onChange={(e) => update(i.draftKey, { note: e.target.value })} aria-label={t('note')} placeholder={t('note')} disabled={!canManage} autoFocus />
                  ) : (
                    <>
                      {savedNote(i) ? <span className="text-meta text-ink-2">{t('noteText', { note: savedNote(i)! })}</span> : null}
                      {canManage ? (
                        // 13 px, normal, direkt unter der Beschreibung — leiser als die Punkte (Runde 6, 15a).
                        <Button type="button" variant="link" className="h-auto w-fit p-0 text-meta font-normal" onClick={() => setNoting((set) => new Set(set).add(i.draftKey))} data-testid="handover-item-note">
                          {savedNote(i) ? t('noteEdit') : t('noteAdd')}
                        </Button>
                      ) : null}
                    </>
                  )}
                </span>
                {i.key === 'custom' && !i.id ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t('remove')} onClick={() => setItems((list) => list.filter((x) => x.draftKey !== i.draftKey))}>
                    <X className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {canManage ? (
            <div className="mt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setItems((list) => [...list, { key: 'custom', label: '', note: '', checked: false, draftKey: `new-${list.length}-${Date.now()}` }])} data-testid="handover-item-add">
                {t('add')}
              </Button>
            </div>
          ) : null}
        </div>
        {changed > 0 ? (
          <p className="text-meta text-muted-ink" data-testid="handover-print-unsaved">
            {t('saveFirst')}
          </p>
        ) : null}
        {canManage ? (
          <FormActionBar surface="plain" count={changed} onSave={() => void save()} onDiscard={() => setItems(initial)} pending={pending} state={withUnplacedFieldErrors(feedback.state, [])} saveTestId="handover-items-save" extraActions={<>{print}{scan}</>} />
        ) : (
          <div>{print}</div>
        )}
      </form>
      <RefusalNotice state={file.refusal} />
      {canManage ? <ProtocolScanDialog open={scanning} onOpenChange={setScanning} id={h.id} /> : null}
    </div>
  );
}

/** „Scan ablegen …“ (wie `ScanDialog`, nur Datei): das von beiden unterschriebene Protokoll als PDF. */
function ProtocolScanDialog({ open, onOpenChange, id }: { open: boolean; onOpenChange: (open: boolean) => void; id: string }) {
  const ts = useTranslations('finance.closing.handover.scanDialog');
  const router = useRouter();
  const [picked, setPicked] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  useEffect(() => {
    if (!open) return;
    setPicked(null);
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const save = async () => {
    setPending(true);
    const formData = new FormData();
    formData.append('id', id);
    if (picked) formData.append('file', picked);
    const result = await feedback.run(() => fileProtocolAction(formData), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(ts('done'));
    onOpenChange(false);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="handover-scan-dialog">
        <DialogHeader>
          <DialogTitle>{ts('title')}</DialogTitle>
          <DialogDescription>{ts('description')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-2">
            <Overline field>{ts('file')}</Overline>
            <ReceiptDrop onFiles={(files) => setPicked(files[0] ?? null)} disabled={pending} />
            {picked ? <p className="text-hint text-muted-ink">{ts('chosen', { name: picked.name })}</p> : null}
            <RefusalNotice state={withUnplacedFieldErrors(feedback.state, [])} />
          </div>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={() => onOpenChange(false)} pending={pending} saveLabel={ts('save')} onSave={() => void save()} saveDisabled={!picked} testId="handover-scan-footer" />
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { ActionState } from '@/lib/actions';
import { nameOf } from '@/lib/folder-tree-model';
import { FormField } from '@/components/forms/form-field';

/**
 * Einstieg in den Aktenexport: ein Ordner (samt Unterordnern) oder ein
 * Jahrgang als ZIP. Absenden wie `admin/backup/export-card.tsx` — ein Blob und
 * ein flüchtiger `<a download>`, kein Server Action, denn der Dienst liefert
 * Bytes, keinen Formularzustand.
 */
export function ExportDialog({
  canExport,
  folder,
  currentYear,
  open: controlledOpen,
  onOpenChange,
}: {
  canExport: boolean;
  folder: string | null;
  currentYear: number;
  /** Gesteuert (aus dem Menü am Ordner): ohne eigenen Knopf, offen nach Vorgabe. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations('dms.export');
  const tCommon = useTranslations('common');
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : ownOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [mode, setMode] = useState<'folder' | 'year'>(folder ? 'folder' : 'year');
  const [year, setYear] = useState(currentYear);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<ActionState>({ status: 'idle' });

  if (!canExport) return null;

  const run = async () => {
    setBusy(true);
    setRefusal({ status: 'idle' });
    try {
      const body = mode === 'folder' && folder ? { folder } : { year };
      const res = await fetch('/dms/export', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        if (res.status === 409) {
          const error: unknown = await res.json().catch(() => null);
          const message = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : t('failed');
          setRefusal({ status: 'error', message, fieldErrors: {} });
        } else if (res.status === 403) {
          setRefusal({ status: 'error', message: t('forbidden'), fieldErrors: {} });
        } else {
          setRefusal({ status: 'error', message: t('failed'), fieldErrors: {} });
        }
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'buendel.zip';
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      // Der Anker muss im Dokument hängen: ein Klick auf ein losgelöstes
      // Element löst in Safari und Firefox keinen Download aus.
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setOpen(false);
    } catch {
      // Der Server war nicht zu erreichen: keine Ablehnung, sondern ein Toast zum Wiederholen.
      toast.error(tCommon('network'), { duration: Infinity, closeButton: true, action: { label: tCommon('retry'), onClick: () => void run() } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {controlled ? null : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          {t('open')}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md" className="bg-surface shadow-md">
          <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>

          <div className="mt-5">
            <RadioGroup aria-label={t('title')} value={mode} onValueChange={(value) => setMode(value as 'folder' | 'year')} className="gap-4">
              {folder ? (
                <label className="flex items-center gap-2 text-[14px] text-ink">
                  <RadioGroupItem value="folder" />
                  {/* Der Name, nie der Weg mit Schrägstrichen. */}
                  {t('thisFolder', { folder: nameOf(folder) })}
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-[14px] text-ink">
                <RadioGroupItem value="year" />
                {t('year')}
              </label>
            </RadioGroup>
            {/* Außerhalb der Gruppe: Die Pfeiltasten gehören dem Zahlfeld, nicht dem Wechsel der Option. */}
            <FormField id="export-year" label={t('yearLabel')} className="mt-1.5 ml-6">
              <Input
                id="export-year"
                type="number"
                value={year}
                onFocus={() => setMode('year')}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-32"
              />
            </FormField>
          </div>

          <p className="mt-4 text-[12px] text-muted-ink">{t('hint')}</p>

          <FormActionBar placement="dialog" cancel={() => setOpen(false)} pending={busy} saveLabel={busy ? t('working') : t('submit')} onSave={() => void run()} state={refusal} />
        </DialogContent>
      </Dialog>
    </>
  );
}

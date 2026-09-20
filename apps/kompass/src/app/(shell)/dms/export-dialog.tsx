'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Einstieg in den Aktenexport: ein Ordner (samt Unterordnern) oder ein
 * Jahrgang als ZIP. Absenden wie `admin/backup/export-card.tsx` — ein Blob und
 * ein flüchtiger `<a download>`, kein Server Action, denn der Dienst liefert
 * Bytes, keinen Formularzustand.
 */
export function ExportDialog({ canExport, folder, currentYear }: { canExport: boolean; folder: string | null; currentYear: number }) {
  const t = useTranslations('dms.export');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'folder' | 'year'>(folder ? 'folder' : 'year');
  const [year, setYear] = useState(currentYear);
  const [busy, setBusy] = useState(false);

  if (!canExport) return null;

  const run = async () => {
    setBusy(true);
    try {
      const body = mode === 'folder' && folder ? { folder } : { year };
      const res = await fetch('/dms/export', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        if (res.status === 409) {
          const error: unknown = await res.json().catch(() => null);
          const message = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : t('failed');
          toast.error(message);
        } else if (res.status === 403) {
          toast.error(t('forbidden'));
        } else {
          toast.error(t('failed'));
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t('open')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-full sm:max-w-[480px] bg-surface p-6 shadow-md">
          <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>

          <div className="mt-5 space-y-4">
            {folder ? (
              <label className="flex items-center gap-2 text-[14px] text-ink">
                <input
                  type="radio"
                  name="export-mode"
                  className="size-4"
                  checked={mode === 'folder'}
                  onChange={() => setMode('folder')}
                />
                {t('thisFolder', { folder })}
              </label>
            ) : null}

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-[14px] text-ink">
                <input
                  type="radio"
                  name="export-mode"
                  className="size-4"
                  checked={mode === 'year'}
                  onChange={() => setMode('year')}
                />
                {t('year')}
              </label>
              <div className="ml-6 space-y-1.5">
                <Label htmlFor="export-year">{t('yearLabel')}</Label>
                <Input
                  id="export-year"
                  type="number"
                  value={year}
                  onFocus={() => setMode('year')}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="w-32"
                />
              </div>
            </div>
          </div>

          <p className="mt-4 text-[12px] text-muted-ink">{t('hint')}</p>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="button" disabled={busy} aria-busy={busy} onClick={run}>
              <Download className="size-4" aria-hidden />
              {busy ? t('working') : t('submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

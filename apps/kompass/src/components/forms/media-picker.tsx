'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { uploadMediaAction } from '@/app/(shell)/media-actions';

export function MediaPicker({ name, value, label, accept = 'image/png,image/jpeg,image/webp,image/svg+xml' }: { name: string; value: string | null; label: string; accept?: string }) {
  const t = useTranslations('content');
  const [assetId, setAssetId] = useState<string | null>(value);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const upload = (file: File) => start(async () => {
    const fd = new FormData();
    fd.set('file', file);
    const s = await uploadMediaAction(fd);
    if (s.status === 'success') setAssetId((s.data as { id: string }).id);
    else if (s.status === 'error') toast.error(s.message);
  });
  return (
    <div className="flex items-center gap-3">
      <input type="hidden" name={name} value={assetId ?? ''} />
      {assetId ? <img src={`/media/${assetId}`} alt="" className="size-14 rounded-md border border-line object-cover" /> : <div className="size-14 rounded-md border border-dashed border-line-strong bg-surface-2" aria-hidden />}
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-ink-2">{label}</span>
        <div className="flex gap-2">
          <input ref={input} type="file" accept={accept} aria-label={`${label} ${t('chooseFile')}`} className="text-[12px]" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} disabled={pending} />
          {assetId ? <Button type="button" variant="ghost" size="sm" onClick={() => setAssetId(null)}>{t('removeImage')}</Button> : null}
        </div>
      </div>
    </div>
  );
}

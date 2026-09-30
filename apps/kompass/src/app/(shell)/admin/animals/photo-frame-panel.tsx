'use client';

import type { PhotoFrame } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { savePhotoFrameAction } from './actions';

/** Die üblichen Formate; ein anderes, das per MCP gesetzt wurde, steht zusätzlich zur Wahl. */
const ASPECTS = ['4:5', '3:4', '2:3', '1:1', '4:3', '3:2', '16:9'];

export function PhotoFramePanel({ initial, canManage }: { initial: PhotoFrame; canManage: boolean }) {
  const t = useTranslations('animals.admin');
  const [frame, setFrame] = useState(initial);
  const [pending, start] = useTransition();
  const [w, h] = frame.aspect.split(':').map(Number);
  const changed = JSON.stringify(frame) !== JSON.stringify(initial);
  const percent = (value: string) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <section aria-labelledby="photo-frame-heading" className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line-2 px-5 py-3">
        <h2 id="photo-frame-heading" className="text-[14px] font-semibold">{t('frame.title')}</h2>
        <p className="mt-0.5 text-[13px] text-ink-2">{t('frame.intro')}</p>
      </div>
      <div className="flex flex-wrap items-start gap-8 px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="photo-aspect" label={t('frame.aspect')} hint={t('frame.aspectHint')}>
            <Select id="photo-aspect" value={frame.aspect} disabled={!canManage} onChange={(e) => setFrame({ ...frame, aspect: e.target.value })} className="w-auto">
              {(ASPECTS.includes(frame.aspect) ? ASPECTS : [frame.aspect, ...ASPECTS]).map((a) => (
                <option key={a} value={a}>{t.has(`frame.aspects.${a.replace(':', 'x')}`) ? t(`frame.aspects.${a.replace(':', 'x')}`) : a}</option>
              ))}
            </Select>
          </FormField>
          <FormField id="photo-focus-x" label={t('frame.focusX')} hint={t('frame.focusXHint')}>
            <Input id="photo-focus-x" type="number" min={0} max={100} value={frame.focusX} disabled={!canManage} onChange={(e) => setFrame({ ...frame, focusX: percent(e.target.value) })} className="w-24 font-mono" />
          </FormField>
          <FormField id="photo-focus-y" label={t('frame.focusY')} hint={t('frame.focusYHint')}>
            <Input id="photo-focus-y" type="number" min={0} max={100} value={frame.focusY} disabled={!canManage} onChange={(e) => setFrame({ ...frame, focusY: percent(e.target.value) })} className="w-24 font-mono" />
          </FormField>
        </div>
        {/* Eine Skizze des Rahmens, damit man das Format sieht, ohne einen Hund zu öffnen. */}
        <div aria-hidden className="relative w-28 rounded-sm border border-line-strong bg-surface-2" style={{ aspectRatio: `${w} / ${h}` }}>
          <span className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand" style={{ left: `${frame.focusX}%`, top: `${frame.focusY}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-line bg-surface-2 px-5 py-3">
        <Button
          className="ml-auto"
          disabled={!canManage || !changed || pending}
          onClick={() =>
            start(async () => {
              const s = await savePhotoFrameAction(frame);
              if (s.status === 'error') toast.error(s.message);
              else if (s.status === 'success') toast.success(s.message ?? '');
            })
          }
        >
          {t('frame.save')}
        </Button>
      </div>
    </section>
  );
}

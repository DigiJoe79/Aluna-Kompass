'use client';

import type { LocalizedText } from '@kompass/core';
import type { PageBlock } from '@kompass/module-website';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { LocalizedField } from '@/components/forms/localized-field';
import { MediaPicker } from '@/components/forms/media-picker';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const empty = (): PageBlock => ({ id: '', title: { de: '', en: '' }, text: { de: '', en: '' }, imageAssetId: null, href: '', label: { de: '', en: '' } });

export function BlocksEditor({ initial }: { initial: PageBlock[] }) {
  const t = useTranslations('website.pages.blocks');
  const [blocks, setBlocks] = useState<PageBlock[]>(initial);
  const [editing, setEditing] = useState<{ index: number | null; block: PageBlock } | null>(null);
  const readLocalized = (form: HTMLFormElement, name: string): LocalizedText => ({ de: (form.elements.namedItem(`${name}.de`) as HTMLInputElement).value.trim(), en: (form.elements.namedItem(`${name}.en`) as HTMLInputElement).value.trim() });
  const commit = (form: HTMLFormElement) => {
    if (!editing) return;
    const block: PageBlock = {
      id: (form.elements.namedItem('block-id') as HTMLInputElement).value.trim(),
      title: readLocalized(form, 'block-title'),
      text: readLocalized(form, 'block-text'),
      imageAssetId: ((form.elements.namedItem('block-image') as HTMLInputElement).value || null),
      href: (form.elements.namedItem('block-href') as HTMLInputElement).value.trim(),
      label: readLocalized(form, 'block-label'),
    };
    setBlocks((prev) => (editing.index === null ? [...prev, block] : prev.map((b, i) => (i === editing.index ? block : b))));
    setEditing(null);
  };
  return (
    <div className="flex flex-col gap-2 md:col-span-2">
      <input type="hidden" name="blocks__json" value={JSON.stringify(blocks)} />
      <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-ink-2">{t('title')}</span><Button type="button" variant="secondary" size="sm" onClick={() => setEditing({ index: null, block: empty() })}>{t('add')}</Button></div>
      {blocks.length === 0 ? <p className="text-[12px] text-muted-ink">{t('empty')}</p> : null}
      <ul className="flex flex-col gap-1">
        {blocks.map((b, i) => (
          <li key={`${b.id}-${i}`} className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px]">
            {b.imageAssetId ? <img src={`/media/${b.imageAssetId}`} alt="" className="size-8 rounded-sm object-cover" /> : null}
            <span className="font-semibold">{b.title.de || b.id}</span>
            <span className="font-mono text-[11px] text-muted-ink">{b.id} · {b.href}</span>
            <span className="ml-auto flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing({ index: i, block: b })}>{t('edit')}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>{t('remove')}</Button>
              <ReorderButtons ids={blocks.map((x, j) => String(j))} index={i} action={async (ids) => { setBlocks(ids.map((j) => blocks[Number(j)]!)); return { status: 'success' }; }} />
            </span>
          </li>
        ))}
      </ul>
      {editing ? (
        <Dialog open onOpenChange={(o) => { if (!o) setEditing(null); }}>
          <DialogContent className="w-[640px] bg-surface shadow-md">
            <form onSubmit={(e) => { e.preventDefault(); commit(e.currentTarget); }} className="grid gap-3 md:grid-cols-2">
              <DialogTitle className="font-heading text-[19px] md:col-span-2">{editing.index === null ? t('add') : t('edit')}</DialogTitle>
              <div className="flex flex-col gap-1"><Label htmlFor="block-id">{t('id')}</Label><Input id="block-id" name="block-id" defaultValue={editing.block.id} required pattern="[a-z0-9][a-z0-9-]{0,40}" /></div>
              <div className="flex flex-col gap-1"><Label htmlFor="block-href">{t('href')}</Label><Input id="block-href" name="block-href" defaultValue={editing.block.href} /></div>
              <LocalizedField name="block-title" label={t('blockTitle')} value={editing.block.title} required />
              <LocalizedField name="block-text" label={t('text')} kind="textarea" rows={3} value={editing.block.text} />
              <LocalizedField name="block-label" label={t('label')} value={editing.block.label} />
              <div className="md:col-span-2"><MediaPicker name="block-image" value={editing.block.imageAssetId} label={t('image')} /></div>
              <DialogFooter className="md:col-span-2"><Button type="submit">{t('apply')}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

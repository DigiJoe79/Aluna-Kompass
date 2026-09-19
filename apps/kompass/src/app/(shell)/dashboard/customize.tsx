'use client';

import type { AvailableTile, DashboardLayout, DashboardOptionField, LayoutTile } from '@kompass/core';
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { resetDashboardLayoutAction, saveDashboardLayoutAction } from './actions';

const id = (t: { module: string; key: string }) => `${t.module}.${t.key}`;

/**
 * Knopf und Seitenleiste (Spec 2026-09-17, § 6): eingeschaltete Kacheln in
 * Reihenfolge mit Schalter, Pfeilen und Optionen; ausgeschaltete gedämpft am
 * Ende. Jede Änderung speichert sofort — kein Speichern-Knopf, weil das
 * Ergebnis hinter der Leiste sichtbar sein soll.
 */
export function DashboardCustomize({ layout, available }: { layout: DashboardLayout; available: AvailableTile[] }) {
  const t = useTranslations('dashboard');
  const tHome = useTranslations('home');
  const tContent = useTranslations('content');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tiles, setTiles] = useState<LayoutTile[]>(layout.tiles);
  const [pending, start] = useTransition();

  const title = (tile: { module: string; key: string }) => t(`tiles.${tile.module}.${tile.key}.title`);
  const off = available.filter((a) => !tiles.some((x) => id(x) === id(a)));

  const persist = (next: LayoutTile[]) => {
    setTiles(next);
    start(async () => {
      const s = await saveDashboardLayoutAction(next);
      if (s.status === 'error') toast.error(s.message);
      else router.refresh();
    });
  };
  const toggle = (tile: AvailableTile, on: boolean) => {
    if (on) {
      const defaults = Object.fromEntries(tile.options.map((f) => [f.name, f.default]));
      persist([...tiles, { module: tile.module, key: tile.key, options: defaults }]);
    } else persist(tiles.filter((x) => id(x) !== id(tile)));
  };
  const move = (index: number, delta: number) => {
    const next = [...tiles];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    persist(next);
  };
  const setOption = (index: number, name: string, value: unknown) => {
    const next = tiles.map((x, i) => (i === index ? { ...x, options: { ...x.options, [name]: value } } : x));
    persist(next);
  };
  const reset = () =>
    start(async () => {
      const s = await resetDashboardLayoutAction();
      if (s.status === 'success') {
        toast.success(s.message ?? '');
        setTiles((s.data as DashboardLayout).tiles);
        router.refresh();
      } else if (s.status === 'error') {
        toast.error(s.message);
      }
    });

  const optionField = (tile: LayoutTile, index: number, field: DashboardOptionField) => {
    const ns = `tiles.${tile.module}.${tile.key}.options.${field.name}`;
    const inputId = `opt-${id(tile)}-${field.name}`;
    const value = tile.options[field.name] ?? field.default;
    if (field.type === 'boolean') {
      return (
        <div key={field.name} className="flex items-center gap-2">
          <Switch id={inputId} size="sm" checked={Boolean(value)} disabled={pending} onCheckedChange={(v) => setOption(index, field.name, v)} />
          <Label htmlFor={inputId} className="cursor-pointer text-[13px] text-ink-2">{t(`${ns}.label`)}</Label>
        </div>
      );
    }
    if (field.type === 'enum') {
      return (
        <div key={field.name} className="flex items-center gap-2">
          <Label htmlFor={inputId} className="text-[13px] text-ink-2">{t(`${ns}.label`)}</Label>
          <Select id={inputId} value={String(value)} disabled={pending} onChange={(e) => setOption(index, field.name, e.target.value)} className="w-32">
            {field.values.map((v) => (
              <option key={v} value={v}>{t(`${ns}.values.${v}`)}</option>
            ))}
          </Select>
        </div>
      );
    }
    return (
      <div key={field.name} className="flex items-center gap-2">
        <Label htmlFor={inputId} className="text-[13px] text-ink-2">{t(`${ns}.label`)}</Label>
        <Input
          id={inputId}
          type="number"
          min={field.min}
          max={field.max}
          defaultValue={Number(value)}
          disabled={pending}
          className="w-20 font-mono"
          onBlur={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isNaN(n) && n !== value) setOption(index, field.name, n);
          }}
        />
      </div>
    );
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="size-4" data-icon="inline-start" />
        {tHome('customize')}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[420px] gap-0 overflow-y-auto bg-surface p-6 shadow-md" data-testid="dashboard-customize">
          <SheetTitle className="font-heading text-[19px]">{t('customize.title')}</SheetTitle>
          <p className="mt-1 mb-4 text-[13px] text-muted-ink">{t('customize.hint')}</p>
          <ul className="divide-y divide-line-2">
            {tiles.map((tile, index) => {
              const def = available.find((a) => id(a) === id(tile));
              if (!def) return null;
              return (
                <li key={id(tile)} className="flex flex-col gap-2 py-3">
                  <div className="flex items-center gap-2">
                    <Switch id={`tile-${id(tile)}`} checked disabled={pending} onCheckedChange={() => toggle(def, false)} />
                    <Label htmlFor={`tile-${id(tile)}`} className="flex-1 cursor-pointer text-[14px]">{title(tile)}</Label>
                    <Button variant="ghost" size="icon-sm" aria-label={tContent('moveUp')} disabled={pending || index === 0} onClick={() => move(index, -1)}><ArrowUp className="size-4" /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={tContent('moveDown')} disabled={pending || index === tiles.length - 1} onClick={() => move(index, 1)}><ArrowDown className="size-4" /></Button>
                  </div>
                  {def.options.length > 0 ? <div className="flex flex-col gap-2 pl-10">{def.options.map((f) => optionField(tile, index, f))}</div> : null}
                </li>
              );
            })}
            {off.map((tile) => (
              <li key={id(tile)} className="flex items-center gap-2 py-3 opacity-60">
                <Switch id={`tile-${id(tile)}`} checked={false} disabled={pending} onCheckedChange={() => toggle(tile, true)} />
                <Label htmlFor={`tile-${id(tile)}`} className="flex-1 cursor-pointer text-[14px]">{title(tile)}</Label>
                <span className="text-[12px] text-muted-ink">{t('customize.off')}</span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="mt-6 w-fit" disabled={pending || !layout.custom} onClick={reset}>{t('customize.reset')}</Button>
        </SheetContent>
      </Sheet>
    </>
  );
}

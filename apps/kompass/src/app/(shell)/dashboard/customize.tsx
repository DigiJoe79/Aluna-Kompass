'use client';

import type { AvailableTile, DashboardLayout, DashboardLayoutKind, DashboardOptionField, LayoutTile } from '@kompass/core';
import { shortestColumn, tileLength } from '@kompass/core/dashboard-arrangement';
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Fragment, useState, useTransition } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Overline } from '@/components/overline';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { resetDashboardLayoutAction, saveDashboardLayoutAction } from './actions';

const id = (t: { module: string; key: string }) => `${t.module}.${t.key}`;

/**
 * Knopf und Seitenleiste (Spec 2026-09-17, § 6; Zwischenlösung 0.2.12, Entscheid Joe 2026-10-17): oben die Aufteilung
 * (drei gleiche Spalten oder breit und schmal), darunter je Spalte ihre Kacheln mit Schalter, Pfeilen (ordnen nur in
 * der Spalte), darunter hinter „Einstellungen“ die Wahl „Spalte“ und die Optionen; ausgeschaltete gedämpft am Ende.
 * Eingeschaltet kommt eine Kachel ans Ende der kürzesten Spalte — ein und aus gilt für beide Aufteilungen, die Anordnung merkt sich jede für sich.
 * Jede Änderung speichert sofort — kein Speichern-Knopf, weil das Ergebnis hinter der Leiste sichtbar sein soll. Das
 * Ziehen kommt mit dem Entwurf des Designers.
 */
export function DashboardCustomize({ layout: initial, available }: { layout: DashboardLayout; available: AvailableTile[] }) {
  const t = useTranslations('dashboard');
  const tHome = useTranslations('home');
  const tContent = useTranslations('content');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<DashboardLayoutKind>(initial.layout);
  const [columns, setColumns] = useState<LayoutTile[][]>(initial.columns);
  const [pending, start] = useTransition();
  // Alles hier speichert sofort: Die Ablehnung steht oben in der Leiste der Anpassung.
  const feedback = useActionFeedback();

  const title = (tile: { module: string; key: string }) => t(`tiles.${tile.module}.${tile.key}.title`);
  const on = new Set(columns.flat().map(id));
  const off = available.filter((a) => !on.has(id(a)));
  const lengthOf = (tile: LayoutTile) => tileLength(available.find((a) => id(a) === id(tile))?.kind ?? 'count');
  const columnName = (index: number) => (layout === 'thirds' ? t('customize.columns.thirds', { n: index + 1 }) : t(index === 0 ? 'customize.columns.wide' : 'customize.columns.narrow'));

  const apply = (s: { status: string; data?: unknown }) => {
    if (s.status !== 'success') return;
    const saved = s.data as DashboardLayout;
    setLayout(saved.layout);
    setColumns(saved.columns);
    router.refresh();
  };
  const persist = (next: LayoutTile[][]) => {
    setColumns(next);
    start(async () => apply(await feedback.run(() => saveDashboardLayoutAction({ layout, columns: next }))));
  };
  // Umschalten speichert nur das Layout: Der Kern liefert dessen gemerkte Anordnung (beim ersten Wechsel abgeleitet).
  const switchLayout = (next: DashboardLayoutKind) => {
    setLayout(next);
    start(async () => apply(await feedback.run(() => saveDashboardLayoutAction({ layout: next }))));
  };
  const toggle = (tile: AvailableTile, turnOn: boolean) => {
    if (turnOn) {
      const defaults = Object.fromEntries(tile.options.map((f) => [f.name, f.default]));
      const target = shortestColumn(columns, lengthOf);
      persist(columns.map((column, c) => (c === target ? [...column, { module: tile.module, key: tile.key, options: defaults }] : column)));
    } else persist(columns.map((column) => column.filter((x) => id(x) !== id(tile))));
  };
  const move = (c: number, index: number, delta: number) => {
    const column = [...columns[c]!];
    const [item] = column.splice(index, 1);
    column.splice(index + delta, 0, item!);
    persist(columns.map((each, i) => (i === c ? column : each)));
  };
  // In eine andere Spalte: ans Ende der gewählten.
  const moveTo = (c: number, index: number, target: number) => {
    const item = columns[c]![index]!;
    persist(columns.map((each, i) => (i === c ? each.filter((_, j) => j !== index) : i === target ? [...each, item] : each)));
  };
  const setOption = (c: number, index: number, name: string, value: unknown) => {
    persist(columns.map((each, i) => (i === c ? each.map((x, j) => (j === index ? { ...x, options: { ...x.options, [name]: value } } : x)) : each)));
  };
  const reset = () =>
    start(async () => {
      const s = await feedback.run(() => resetDashboardLayoutAction());
      apply(s);
    });

  // Beschriftung und Feld je Option als zwei Zellen im gemeinsamen Raster der Einstellungen (wie `FormGrid`, 208).
  const optionField = (tile: LayoutTile, c: number, index: number, field: DashboardOptionField) => {
    const ns = `tiles.${tile.module}.${tile.key}.options.${field.name}`;
    const inputId = `opt-${id(tile)}-${field.name}`;
    const value = tile.options[field.name] ?? field.default;
    const label = (
      <Label htmlFor={inputId} className={cn('text-meta text-ink-2', field.type === 'boolean' && 'cursor-pointer')}>{t(`${ns}.label`)}</Label>
    );
    if (field.type === 'boolean') {
      // Schalter rechts vom Text wie in den Einstellungszeilen (MUSTER § J, Runde 4).
      return (
        <Fragment key={field.name}>
          {label}
          <Switch id={inputId} size="sm" className="justify-self-start" checked={Boolean(value)} disabled={pending} onCheckedChange={(v) => setOption(c, index, field.name, v)} />
        </Fragment>
      );
    }
    if (field.type === 'enum') {
      return (
        <Fragment key={field.name}>
          {label}
          <Select id={inputId} value={String(value)} disabled={pending} onChange={(e) => setOption(c, index, field.name, e.target.value)} className="w-40">
            {field.values.map((v) => (
              <option key={v} value={v}>{t(`${ns}.values.${v}`)}</option>
            ))}
          </Select>
        </Fragment>
      );
    }
    return (
      <Fragment key={field.name}>
        {label}
        <Input
          id={inputId}
          type="number"
          min={field.min}
          max={field.max}
          defaultValue={Number(value)}
          disabled={pending}
          className="w-20"
          onBlur={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isNaN(n) && n !== value) setOption(c, index, field.name, n);
          }}
        />
      </Fragment>
    );
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="size-4" data-icon="inline-start" />
        {tHome('customize')}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" size="sm" className="gap-0 overflow-y-auto bg-surface shadow-md" data-testid="dashboard-customize">
          <div className="p-5">
            <SheetTitle>{t('customize.title')}</SheetTitle>
            <p className="mt-1 mb-4 text-meta text-muted-ink">{t('customize.hint')}</p>
            <div className="mb-3">
              <RefusalNotice action state={feedback.state} />
            </div>
            <Overline as="div" field>
              <span id="dashboard-layout-label">{t('customize.layout')}</span>
            </Overline>
            <RadioGroup aria-labelledby="dashboard-layout-label" value={layout} onValueChange={(v) => switchLayout(v as DashboardLayoutKind)} disabled={pending} className="mt-2">
              {(['thirds', 'wide-narrow'] as const).map((each) => (
                <label key={each} className="flex cursor-pointer items-center gap-2 text-body">
                  <RadioGroupItem value={each} />
                  {t(`customize.layouts.${each}`)}
                </label>
              ))}
            </RadioGroup>
            {columns.map((column, c) => (
              <div key={c} data-testid={`customize-column-${c}`} className="mt-5">
                <Overline>{columnName(c)}</Overline>
                <ul className="divide-y divide-line-2">
                  {column.map((tile, index) => {
                    const def = available.find((a) => id(a) === id(tile));
                    if (!def) return null;
                    const columnId = `col-${id(tile)}`;
                    return (
                      <li key={id(tile)} data-testid={`customize-tile-${tile.module}-${tile.key}`} className="flex flex-col gap-2 py-3">
                        {/* Schalter rechts vom Text (MUSTER § J, Runde 4); die Pfeile davor, damit alle Schalter eine Spalte bilden. */}
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`tile-${id(tile)}`} className="flex-1 cursor-pointer text-body">{title(tile)}</Label>
                          <Button variant="ghost" size="icon-sm" aria-label={tContent('moveUp')} disabled={pending || index === 0} onClick={() => move(c, index, -1)}><ArrowUp className="size-4" /></Button>
                          <Button variant="ghost" size="icon-sm" aria-label={tContent('moveDown')} disabled={pending || index === column.length - 1} onClick={() => move(c, index, 1)}><ArrowDown className="size-4" /></Button>
                          <Switch id={`tile-${id(tile)}`} checked disabled={pending} onCheckedChange={() => toggle(def, false)} />
                        </div>
                        {/* Spalte und Optionen eingerückt hinter „Einstellungen“ (Zwischenlösung, Designer 2026-10-17, Frage 3);
                            die Beschriftungen stehen in einer gemeinsamen Spalte. `pl-10` liest die Bild-Pipeline (02-start). */}
                        <div className="pl-10">
                          <Disclosure label={t('customize.settings')} bounded={false}>
                            <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-3 gap-y-2 pt-1">
                              <Label htmlFor={columnId} className="text-meta text-ink-2">{t('customize.column')}</Label>
                              <Select id={columnId} value={String(c)} disabled={pending} onChange={(e) => moveTo(c, index, Number(e.target.value))} className="w-40">
                                {columns.map((_, target) => (
                                  <option key={target} value={target}>{columnName(target)}</option>
                                ))}
                              </Select>
                              {def.options.map((f) => optionField(tile, c, index, f))}
                            </div>
                          </Disclosure>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {off.length > 0 ? (
              <div className="mt-5">
                <Overline>{t('customize.off')}</Overline>
                <ul className="divide-y divide-line-2">
                  {off.map((tile) => (
                    <li key={id(tile)} className="flex items-center gap-2 py-3 opacity-60">
                      <Label htmlFor={`tile-${id(tile)}`} className="flex-1 cursor-pointer text-body">{title(tile)}</Label>
                      <Switch id={`tile-${id(tile)}`} checked={false} disabled={pending} onCheckedChange={() => toggle(tile, true)} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Button variant="outline" className="mt-6 w-fit" disabled={pending || !initial.custom} onClick={reset}>{t('customize.reset')}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

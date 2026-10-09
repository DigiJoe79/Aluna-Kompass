'use client';

import { Popover } from '@base-ui/react/popover';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, useState, type ReactNode } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * Ein Filter der Leiste. `control` steht am Rechner in der Leiste und wirkt sofort; `sheet` beschreibt denselben
 * Filter im Telefon-Sheet, wo er erst mit „Anwenden“ wirkt. `chip` ist der gesetzte Wert: Der Chip lautet immer
 * „{label}: {chip}“ („Zustand: festgeschrieben“, Designer 2026-10-08). Ohne `chip` steht `label` allein — so bei
 * Ja/Nein-Filtern, deren Text schon alles sagt („Nur ohne Beleg“).
 */
export type FilterSlot = {
  key: string;
  label: string;
  active: boolean;
  chip?: string;
  onClear: () => void;
  control: ReactNode;
  sheet: { value: string; render: (value: string, onChange: (value: string) => void) => ReactNode; apply: (value: string) => void };
};

/** Nomen der Zählzeile: „1 Hund“, „6 Hunde“, „3 von 6 Hunden“ (nach „von“ der Dativ, Standard `other`). */
export type CountNoun = { one: string; other: string; dative?: string };

/**
 * Klassen für ein Filter-Select (Spec § 3): Der gesetzte Filter ist am Text erkennbar („Sucht ein Zuhause“ statt
 * „Status: alle“), der Rahmen in Primärfarbe kommt nur hinzu. Der Fokusring steht mit Abstand neben dem Rahmen und
 * ersetzt den globalen Umriss, damit Fokus und gesetzter Filter nie gleich aussehen.
 */
export function filterControlClass(active: boolean): string {
  return cn(
    'w-auto max-w-full',
    active && 'border-brand',
    'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
  );
}

/** Eine Option eines Filter-Selects; `chip` kürzt den Wert im Chip, wo die Option den Filternamen wiederholt („Wiedervorlage offen“ → „Wiedervorlage: offen“). */
export type FilterOption = { value: string; label: string; chip?: string };

/** Ein Filter-Select mit Standardoption „{Filter}: alle“; Leerwert heißt „nicht gesetzt“. */
function FilterSelect({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  options: readonly FilterOption[];
  onChange: (value: string) => void;
  testId?: string;
}) {
  const t = useTranslations('common.filterBar');
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} className={filterControlClass(value !== '')}>
      <option value="">{t('all', { filter: label })}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

/** Ein Ja/Nein-Filter als Checkbox „Nur …“ bzw. „Auch …“ (Spec § 3: kein Switch). */
function FilterCheck({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (checked: boolean) => void; testId?: string }) {
  return (
    <label className="flex h-[var(--field-h)] items-center gap-2 text-meta text-ink">
      <Checkbox checked={checked} onCheckedChange={(on) => onChange(on === true)} data-testid={testId} />
      {label}
    </label>
  );
}

/**
 * Baut den Platz eines Filter-Selects: Bedienelement für die Leiste, dasselbe für das Telefon-Sheet, Chip mit dem
 * gewählten Text. `onChange('')` nimmt den Filter zurück.
 */
export function selectFilter(o: {
  key: string;
  label: string;
  value: string;
  options: readonly FilterOption[];
  onChange: (value: string) => void;
  testId?: string;
}): FilterSlot {
  const option = o.options.find((candidate) => candidate.value === o.value);
  return {
    key: o.key,
    label: o.label,
    active: o.value !== '',
    chip: option?.chip ?? option?.label ?? o.value,
    onClear: () => o.onChange(''),
    control: <FilterSelect label={o.label} value={o.value} options={o.options} onChange={o.onChange} testId={o.testId} />,
    sheet: {
      value: o.value,
      render: (value, onChange) => <FilterSelect label={o.label} value={value} options={o.options} onChange={onChange} />,
      apply: o.onChange,
    },
  };
}

/**
 * Baut den Platz eines Rahmens der Seite (Jahr im Spendenbuch und in der Personenübersicht): ein Select ohne
 * „alle“, das den Bestand abgrenzt, den die Zählzeile zählt. Er gilt nie als gesetzter Filter — kein Rahmen in
 * Primärfarbe, kein Chip, kein „Filter zurücksetzen“ —, sonst sähe die Seite dauerhaft gefiltert aus (Designer
 * 2026-10-08). Im Journal ist „Jahr: alle“ dagegen ein echter Filter (`selectFilter`).
 */
export function frameFilter(o: { key: string; label: string; value: string; options: readonly FilterOption[]; onChange: (value: string) => void; testId?: string }): FilterSlot {
  const select = (value: string, onChange: (value: string) => void, testId?: string) => (
    <Select aria-label={o.label} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} className={filterControlClass(false)}>
      {o.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
  return {
    key: o.key,
    label: o.label,
    active: false,
    onClear: () => undefined,
    control: select(o.value, o.onChange, o.testId),
    sheet: { value: o.value, render: (value, onChange) => select(value, onChange), apply: o.onChange },
  };
}

/** Baut den Platz eines Ja/Nein-Filters; im Sheet steht der Wert als „1“ oder leer. */
export function checkFilter(o: { key: string; label: string; value: boolean; onChange: (checked: boolean) => void; testId?: string }): FilterSlot {
  return {
    key: o.key,
    label: o.label,
    active: o.value,
    onClear: () => o.onChange(false),
    control: <FilterCheck label={o.label} checked={o.value} onChange={o.onChange} testId={o.testId} />,
    sheet: {
      value: o.value ? '1' : '',
      render: (value, onChange) => <FilterCheck label={o.label} checked={value === '1'} onChange={(on) => onChange(on ? '1' : '')} />,
      apply: (value) => o.onChange(value === '1'),
    },
  };
}

/**
 * Filterleiste einer Liste (Board § L Ziele 1, 2, 5; HANDOFF § 8e.1; Spec 2026-10-08 § 2/§ 3).
 *
 * Feste Plätze: Suche, bis zu drei Filter, „Weitere Filter (n)“ als Popover, rechts Zählzeile und „Filter
 * zurücksetzen“, dann `sort` (kein Filter: zählt nicht als gesetzt, löst kein Zurücksetzen aus) und `view`
 * ganz rechts. Chips je gesetztem Filter erscheinen, wenn es `more` gibt oder ein versteckter Filter (`hidden`)
 * gesetzt ist; die Zählzeile rückt dann in die Chip-Zeile.
 *
 * Unter 640 px: Suche über die volle Breite, alle Filter hinter „Filter (n)“ im Sheet von unten, Zählzeile in
 * eigener Zeile. Drei Regeln für das Sheet:
 *   1. Filter im Sheet wirken erst mit „Anwenden“ (am Rechner sofort).
 *   2. Schließen ohne „Anwenden“ (✕, Escape, Wischen) verwirft den Entwurf.
 *   3. „Zurücksetzen“ wirkt sofort und schließt.
 * „Anwenden“ ruft `onApply` einmal mit allen geänderten Werten, wenn gesetzt — sonst `apply` je geändertem Slot.
 * Wer mehrere Werte in dieselbe Adresse schreibt, nimmt `onApply`, damit kein Schreiben ein anderes überholt.
 */
export function FilterBar({
  search,
  searchActive,
  filters,
  more = [],
  hidden = [],
  count,
  onReset,
  onApply,
  sort,
  view,
  testId,
}: {
  search?: ReactNode;
  /** Gesetzte Suche; `chip` ist der Suchtext, der Chip lautet „Suche: {chip}“. */
  searchActive?: { chip: string; onClear: () => void };
  filters: readonly FilterSlot[];
  more?: readonly FilterSlot[];
  hidden?: readonly FilterSlot[];
  count: { shown: number; total: number; noun: CountNoun };
  onReset: () => void;
  onApply?: (values: Record<string, string>) => void;
  sort?: ReactNode;
  view?: ReactNode;
  testId?: string;
}) {
  const t = useTranslations('common.filterBar');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const sheetSlots = [...filters, ...more];
  const activeMore = more.filter((slot) => slot.active).length;
  const activeAll = [...filters, ...more, ...hidden].filter((slot) => slot.active).length;
  const filtered = activeAll > 0 || Boolean(searchActive);

  // Jeder Chip nennt den Filter und seinen Wert; nur Ja/Nein-Filter (ohne `chip`) stehen mit ihrem Text allein.
  const chipText = (label: string, value?: string) => (value ? t('chip', { label, value }) : label);
  const chips = [
    ...(searchActive ? [{ key: '__search', chip: chipText(t('search'), searchActive.chip), onClear: searchActive.onClear }] : []),
    ...[...filters, ...more, ...hidden].filter((slot) => slot.active).map((slot) => ({ key: slot.key, chip: chipText(slot.label, slot.chip), onClear: slot.onClear })),
  ];
  const showChips = (more.length > 0 || hidden.some((slot) => slot.active)) && chips.length > 0;

  const noun = count.total === 1 ? count.noun.one : filtered ? (count.noun.dative ?? count.noun.other) : count.noun.other;
  const countText = filtered ? t('countFiltered', { shown: count.shown, total: count.total, noun }) : t('count', { total: count.total, noun });

  const countGroup = (
    <div className="ml-auto flex items-center gap-3 whitespace-nowrap max-sm:order-last max-sm:basis-full max-sm:justify-between">
      <span aria-live="polite" className="text-meta text-muted-ink tabular-nums">
        {countText}
      </span>
      {filtered ? (
        <Button type="button" variant="link" onClick={onReset} className="h-auto px-0 text-meta font-normal underline">
          {t('reset')}
        </Button>
      ) : null}
    </div>
  );

  const openSheet = (open: boolean) => {
    if (open) setDraft(Object.fromEntries(sheetSlots.map((slot) => [slot.key, slot.sheet.value])));
    setSheetOpen(open);
  };
  const applySheet = () => {
    const changed = Object.fromEntries(sheetSlots.filter((slot) => draft[slot.key] !== slot.sheet.value).map((slot) => [slot.key, draft[slot.key] ?? '']));
    if (onApply) onApply(changed);
    else for (const slot of sheetSlots) if (slot.key in changed) slot.sheet.apply(changed[slot.key]!);
    setSheetOpen(false);
  };
  const resetSheet = () => {
    onReset();
    setSheetOpen(false);
  };

  return (
    <div data-testid={testId} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        {search ? <div className="max-sm:min-w-0 max-sm:flex-1">{search}</div> : null}
        <div className="contents max-sm:hidden">
          {filters.map((slot) => (
            <Fragment key={slot.key}>{slot.control}</Fragment>
          ))}
          {more.length > 0 ? (
            <Popover.Root>
              <Popover.Trigger render={<Button type="button" variant="outline" />}>
                {t('more')}{' '}
                {activeMore > 0 ? <StatusBadge tone="neutral">{activeMore}</StatusBadge> : null}
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner className="isolate z-50 outline-none" side="bottom" align="start" sideOffset={4}>
                  <Popover.Popup className="flex min-w-56 flex-col items-start gap-3 rounded-lg bg-surface p-3 text-ink shadow-md ring-1 ring-line outline-none">
                    {more.map((slot) => (
                      <Fragment key={slot.key}>{slot.control}</Fragment>
                    ))}
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          ) : null}
        </div>
        {sheetSlots.length > 0 ? (
          <Sheet open={sheetOpen} onOpenChange={openSheet}>
            <Button type="button" variant="outline" onClick={() => openSheet(true)} className={cn('sm:hidden', activeAll > 0 && 'border-brand')}>
              {t('filters')}{' '}
              {activeAll > 0 ? <StatusBadge tone="neutral">{activeAll}</StatusBadge> : null}
            </Button>
            <SheetContent side="bottom" size="sm">
              <SheetHeader>
                <SheetTitle>{t('sheetTitle')}</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col items-start gap-4 px-5">
                {sheetSlots.map((slot) => (
                  <Fragment key={slot.key}>
                    {slot.sheet.render(draft[slot.key] ?? slot.sheet.value, (value) => setDraft((now) => ({ ...now, [slot.key]: value })))}
                  </Fragment>
                ))}
              </div>
              <SheetFooter className="flex-row justify-end">
                <Button type="button" variant="outline" onClick={resetSheet}>
                  {t('resetShort')}
                </Button>
                <Button type="button" onClick={applySheet}>
                  {t('apply')}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        ) : null}
        {showChips ? null : countGroup}
        {/* Telefon: Sortierung und Ansicht in eigener Zeile. In der ersten Zeile stehen nur Suche und „Filter“ — mit dem
            breiten Sortier-Select daneben quetschte sich die Suche der Mediathek auf 130 px, auf dem iPhone schob sich das
            Feld unter den Knopf (Joe 2026-10-08). Kein Layout-Test für diese Einzelstelle (Projektregel); geprüft in WebKit
            „iPhone 14“ gegen den Dev-Container. */}
        {sort || view ? (
          <div className="flex items-center gap-2.5 max-sm:basis-full">
            {sort}
            {view}
          </div>
        ) : null}
      </div>
      {showChips ? (
        <div data-testid="filter-chips" className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <Button
              key={chip.key}
              type="button"
              variant="outline"
              size="sm"
              aria-label={t('removeChip', { label: chip.chip })}
              onClick={chip.onClear}
              className="h-7 rounded-full pr-1.5 pl-2.5 text-meta font-normal"
            >
              {chip.chip}
              <X aria-hidden className="text-muted-ink" />
            </Button>
          ))}
          {countGroup}
        </div>
      ) : null}
    </div>
  );
}

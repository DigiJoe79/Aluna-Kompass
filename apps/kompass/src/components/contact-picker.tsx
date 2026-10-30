'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { CreateContactDialog } from '@/app/(shell)/contacts/contact-form';
import { searchContactsAction } from '@/app/(shell)/contacts/search-action';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { useHiddenInputEvent } from '@/lib/use-hidden-input-event';
import { cn } from '@/lib/utils';

export interface PickedContact {
  id: string;
  name: string;
  /** Nur in der Trefferliste: sagt, warum ein Treffer da ist. */
  city?: string | null;
  /** Die Organisation einer Person: „Sabine Klein · Finanzamt“ (Nachtrag Ansprechpersonen § 4). */
  organization?: string | null;
}

/** Was im gewählten Feld steht: der Name, bei einer Person mit Organisation „Name · Organisation“. */
const pickedLabel = (contact: PickedContact | null) => (contact ? (contact.organization ? `${contact.name} · ${contact.organization}` : contact.name) : '');

const LIST_MAX = 256;
const LIST_MIN = 160;
const LIST_GAP = 4;
const VIEW_MARGIN = 8;

/**
 * Die Liste liegt fest am Fenster, weil die Formularkarte mit `overflow-clip` eine absolute Liste am Kartenrand
 * abschneidet (0.5.0 Nr. 30); `fixed` entkommt dem Clip, ohne den Baum zu verlassen, Fokus und Schließen bleiben. Reicht
 * der Platz unten nicht, öffnet sie nach oben. In einem Dialog bleibt sie absolut: Dort clippt nichts, und sein
 * `transform` wäre der Bezug für `fixed`.
 */
function listPlace(field: Element): CSSProperties | null {
  if (field.closest('[role="dialog"]')) return null;
  const box = field.getBoundingClientRect();
  const below = window.innerHeight - box.bottom - LIST_GAP - VIEW_MARGIN;
  const above = box.top - LIST_GAP - VIEW_MARGIN;
  const up = below < LIST_MIN && above > below;
  return {
    position: 'fixed',
    left: box.left,
    right: 'auto',
    width: box.width,
    maxHeight: Math.min(LIST_MAX, up ? above : below),
    ...(up ? { top: 'auto', bottom: window.innerHeight - box.top + LIST_GAP, marginTop: 0 } : { top: box.bottom + LIST_GAP, marginTop: 0 }),
  };
}

/**
 * Ein Suchfeld statt einer Auswahlliste über die ersten 200 Kontakte. Die ID
 * reist in einem versteckten Feld mit, damit die Formulare unverändert per
 * FormData arbeiten. „Neu anlegen“ öffnet das vorhandene Kontaktformular als
 * Overlay; der neue Kontakt ist danach gewählt.
 */
export function ContactPicker({
  id,
  name,
  label,
  value,
  onChange,
  required,
  canCreate,
  hint,
  kind,
  role,
  suggested,
}: {
  id: string;
  name: string;
  label: string;
  value: PickedContact | null;
  onChange: (contact: PickedContact | null) => void;
  required?: boolean;
  canCreate?: boolean;
  hint?: string;
  /** Nur Personen oder nur Organisationen anbieten (z. B. Zählende an der Barkasse). */
  kind?: 'person' | 'organization';
  /** Nur Kontakte mit dieser Rolle anbieten (z. B. Mitglieder für die Leitung einer Sitzung). */
  role?: string;
  /** Vorbelegt aus einem Vorschlag (MUSTER § E): Rahmen im Token `agent`, die Herkunft steht im `hint`. */
  suggested?: boolean;
}) {
  const t = useTranslations('contacts.picker');
  const [query, setQuery] = useState(pickedLabel(value));
  const [options, setOptions] = useState<PickedContact[]>([]);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  /**
   * Bis die Suche geantwortet hat, zeigt die Liste nichts Anklickbares. Sonst
   * steht „Neu anlegen …“ allein da, die Treffer schieben es beim Eintreffen
   * nach unten, und wer gerade die Maus gedrückt hält, lässt sie über einem
   * anderen Eintrag los — der Klick trifft dann keinen (Befund 2026-09-12).
   */
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(0);
  const hiddenRef = useHiddenInputEvent(value?.id ?? '');
  // Das verzögerte Schließen nach dem Verlassen des Felds; beim Entfernen weggeräumt, sonst setzt es danach noch Zustand.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    setQuery(pickedLabel(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.id, value?.name, value?.organization]);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    const run = ++latest.current;
    const handle = setTimeout(async () => {
      const found = await searchContactsAction(query, kind, role);
      if (run !== latest.current) return;
      setOptions(found.contacts);
      setMore(found.more);
      setLoaded(true);
    }, 150);
    return () => clearTimeout(handle);
  }, [query, open, kind, role]);

  const rootRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const field = rootRef.current?.querySelector('[data-slot="command-input"]')?.parentElement;
    if (!field) return;
    const update = () => setPlace(listPlace(field));
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  const pick = (contact: PickedContact | null) => {
    onChange(contact);
    setQuery(pickedLabel(contact));
    setOpen(false);
  };

  return (
    // `gap` statt `space-y`: Letzteres gibt jedem Kind außer dem letzten Abstand nach unten, und das unsichtbare
    // Statusfeld (`sr-only`) hinter dem Feld macht dieses zum „nicht letzten“ — es saß 6 px höher als Nachbarfelder.
    // `relative`: Halt für das absolut positionierte Statusfeld unten, damit es das Dokument nicht verlängert (Arbeitsliste,
    // 2026-10-20). Am Wurzelelement statt in einem eigenen Behälter: Ein Behälter im Fluss bekäme wieder ein `gap`.
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <input ref={hiddenRef} type="hidden" name={name} value={value?.id ?? ''} />
      {/* Der Rahmen sitzt am Feld, nicht an der Hülle: `h-auto` gegen das
          `size-full` der Palette, sonst nimmt die Hülle in einer Rasterzelle
          neben einem höheren Nachbarn die Zellenhöhe und rahmt das 38-px-Feld
          ein zweites Mal ein (Befund 3, 2026-09-12). */}
      <Command shouldFilter={false} className="relative h-auto overflow-visible bg-transparent p-0">
        <CommandInput
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          value={query}
          onValueChange={(next) => {
            setQuery(next);
            if (value && next !== pickedLabel(value)) onChange(null);
            setOpen(true);
          }}
          // Fokus allein öffnet die Liste nicht (Designer Runde 5, 270/271): Ein Dialog setzt den Fokus beim Öffnen ins
          // Feld, die Liste verdeckte dann die Felder darunter. Sie erscheint beim Tippen, beim Klick ins Feld und mit ↓.
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !open) setOpen(true);
          }}
          onBlur={() => {
            closeTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          placeholder={t('placeholder')}
          // Passt der Name nicht, kürzt das Feld mit „…“; der volle Name steht im Tooltip (Designer Runde 8, 093/094).
          className="min-w-0 truncate"
          title={value ? pickedLabel(value) : undefined}
          wrapperClassName="p-0"
          fieldClassName={cn('h-[var(--field-h)] rounded-md! bg-field', suggested ? 'border-agent' : 'border-line-strong')}
        />
        {open ? (
          // `preventDefault` beim Drücken: Sonst verliert das Feld den Fokus,
          // die Liste schließt nach 120 ms, und ein Klick, der länger dauert,
          // trifft ins Leere — Enter ging, die Maus nicht (Befund 2026-09-12).
          <CommandList
            onMouseDown={(e) => e.preventDefault()}
            style={place ?? undefined}
            className={cn('absolute left-0 right-0 top-full z-50 mt-1 max-h-64 rounded-md border border-line bg-surface shadow-md')}
          >
            {!loaded ? (
              <div role="presentation" aria-hidden className="px-3 py-2 text-meta text-muted-ink">
                {t('searching')}
              </div>
            ) : (
              <>
                <CommandEmpty>{t('empty')}</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem key={option.id} value={option.id} data-testid="contact-option" data-name={option.name} onSelect={() => pick(option)}>
                      {/* Einzeilig: Der Name wird gekürzt, der Ort bleibt stehen. Ein
                          zweizeiliger Treffer verschiebt die Liste unter der Maus. */}
                      <span className="min-w-0 truncate">
                        {option.name}
                        {option.organization ? <span className="text-muted-ink"> · {option.organization}</span> : null}
                      </span>
                      {option.city ? <span className="ml-auto shrink-0 pl-2 text-hint text-muted-ink">{option.city}</span> : null}
                    </CommandItem>
                  ))}
                  {more ? (
                    <div role="presentation" aria-hidden className="px-3 py-1.5 text-hint text-muted-ink" data-testid="contact-more">
                      {t('more')}
                    </div>
                  ) : null}
                  {value ? (
                    <CommandItem value="__clear" onSelect={() => pick(null)} className="text-muted-ink">
                      {t('clear')}
                    </CommandItem>
                  ) : null}
                  {canCreate ? (
                    <CommandItem value="__create" onSelect={() => { setOpen(false); setCreating(true); }} className="border-t border-line-2 font-semibold">
                      {t('create')}
                    </CommandItem>
                  ) : null}
                </CommandGroup>
              </>
            )}
          </CommandList>
        ) : null}
      </Command>
      {/* Die Hinweise der Liste sind nur zu sehen (`aria-hidden`); angesagt werden sie hier. Die Region steht
          immer da, auch bei geschlossener Liste — eine erst mit dem Text eingefügte Region sagt ein
          Screenreader nicht an (Teil C Task 2). */}
      <p role="status" aria-live="polite" className="sr-only" data-testid="contact-picker-status">
        {open ? (!loaded ? t('searching') : more ? t('more') : '') : ''}
      </p>
      {hint ? <p className="text-hint text-muted-ink">{hint}</p> : null}
      {canCreate ? (
        <CreateContactDialog withTrigger={false} open={creating} onOpenChange={setCreating} onCreated={(contact) => pick(contact)} initialKind={kind ?? 'person'} />
      ) : null}
    </div>
  );
}

'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { CreateContactDialog } from '@/app/(shell)/contacts/contact-form';
import { searchContactsAction } from '@/app/(shell)/contacts/search-action';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface PickedContact {
  id: string;
  name: string;
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
}: {
  id: string;
  name: string;
  label: string;
  value: PickedContact | null;
  onChange: (contact: PickedContact | null) => void;
  required?: boolean;
  canCreate?: boolean;
  hint?: string;
}) {
  const t = useTranslations('contacts.picker');
  const [query, setQuery] = useState(value?.name ?? '');
  const [options, setOptions] = useState<PickedContact[]>([]);
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

  useEffect(() => {
    setQuery(value?.name ?? '');
  }, [value?.id, value?.name]);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    const run = ++latest.current;
    const handle = setTimeout(async () => {
      const found = await searchContactsAction(query);
      if (run !== latest.current) return;
      setOptions(found);
      setLoaded(true);
    }, 150);
    return () => clearTimeout(handle);
  }, [query, open]);

  const pick = (contact: PickedContact | null) => {
    onChange(contact);
    setQuery(contact?.name ?? '');
    setOpen(false);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <input type="hidden" name={name} value={value?.id ?? ''} />
      <Command shouldFilter={false} className="relative overflow-visible rounded-md border border-line-strong bg-field p-0">
        <CommandInput
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          value={query}
          onValueChange={(next) => {
            setQuery(next);
            if (value && next !== value.name) onChange(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={t('placeholder')}
          wrapperClassName="p-0"
          fieldClassName="h-[var(--field-h)] rounded-md! border-none bg-transparent"
        />
        {open ? (
          // `preventDefault` beim Drücken: Sonst verliert das Feld den Fokus,
          // die Liste schließt nach 120 ms, und ein Klick, der länger dauert,
          // trifft ins Leere — Enter ging, die Maus nicht (Befund 2026-09-12).
          <CommandList
            onMouseDown={(e) => e.preventDefault()}
            className={cn('absolute left-0 right-0 top-full z-20 mt-1 max-h-64 rounded-md border border-line bg-surface shadow-md')}
          >
            {!loaded ? (
              <div role="presentation" className="px-3 py-2 text-[13px] text-muted-ink">
                {t('searching')}
              </div>
            ) : (
              <>
                <CommandEmpty>{t('empty')}</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem key={option.id} value={option.id} data-testid="contact-option" onSelect={() => pick(option)}>
                      {option.name}
                    </CommandItem>
                  ))}
                  {value ? (
                    <CommandItem value="__clear" onSelect={() => pick(null)} className="text-muted-ink">
                      {t('clear')}
                    </CommandItem>
                  ) : null}
                  {canCreate ? (
                    <CommandItem value="__create" onSelect={() => { setOpen(false); setCreating(true); }} className="border-t border-line-2 font-semibold">
                      <Plus className="size-3.5" aria-hidden />
                      {t('create')}
                    </CommandItem>
                  ) : null}
                </CommandGroup>
              </>
            )}
          </CommandList>
        ) : null}
      </Command>
      {hint ? <p className="text-[12px] text-muted-ink">{hint}</p> : null}
      {canCreate ? (
        <CreateContactDialog withTrigger={false} open={creating} onOpenChange={setCreating} onCreated={(contact) => pick(contact)} />
      ) : null}
    </div>
  );
}

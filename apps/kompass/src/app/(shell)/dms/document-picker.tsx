'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { searchDocumentsAction, type PickedDocument } from './search-action';

/**
 * Dasselbe Suchfeld wie für Kontakte, nur gegen die Akte: Ein Dokument wird
 * über Nummer oder Betreff gefunden, die ID reist im versteckten Feld mit.
 */
export function DocumentPicker({
  id,
  name,
  label,
  value,
  onChange,
  exceptId,
  required,
}: {
  id: string;
  name: string;
  label: string;
  value: PickedDocument | null;
  onChange: (doc: PickedDocument | null) => void;
  exceptId?: string;
  required?: boolean;
}) {
  const t = useTranslations('dms.picker');
  const labelOf = (doc: PickedDocument) => (doc.number ? `${doc.number} · ${doc.subject}` : doc.subject);
  const [query, setQuery] = useState(value ? labelOf(value) : '');
  const [options, setOptions] = useState<PickedDocument[]>([]);
  const [open, setOpen] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    setQuery(value ? labelOf(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.id]);

  useEffect(() => {
    if (!open) return;
    const run = ++latest.current;
    const handle = setTimeout(async () => {
      const found = await searchDocumentsAction(query, exceptId);
      if (run === latest.current) setOptions(found);
    }, 150);
    return () => clearTimeout(handle);
  }, [query, open, exceptId]);

  const pick = (doc: PickedDocument | null) => {
    onChange(doc);
    setQuery(doc ? labelOf(doc) : '');
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
            if (value) onChange(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={t('placeholder')}
          wrapperClassName="p-0"
          fieldClassName="h-[var(--field-h)] rounded-md! border-none bg-transparent"
        />
        {open ? (
          <CommandList className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 rounded-md border border-line bg-surface shadow-md">
            <CommandEmpty>{t('empty')}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option.id} value={option.id} data-testid="document-option" onSelect={() => pick(option)}>
                  {labelOf(option)}
                  {option.phase === 'draft' ? <span className="ml-2 text-[12px] text-muted-ink">{t('draft')}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        ) : null}
      </Command>
    </div>
  );
}

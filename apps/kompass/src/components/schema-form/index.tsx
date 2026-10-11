'use client';

import { fieldGroups, type FieldSchema } from '@kompass/module-site/client';
import type { ReactNode } from 'react';
import { FormGrid } from '@/components/forms/form-grid';
import { Section } from '@/components/section';
import { cn } from '@/lib/utils';
import { SchemaField, type SchemaMedia } from './field';
import { withBlanks } from './state';

export { blankFor, setAtPath, withBlanks } from './state';

export interface SchemaFormProps {
  /** Das gespeicherte JSON-Schema je Feld — die Variablen eines Templates oder die Felder einer Sammlung. */
  schema: Record<string, FieldSchema>;
  value: Record<string, unknown>;
  errors?: Record<string, string>;
  locales: string[];
  onChange: (next: Record<string, unknown>) => void;
  /** Wählbare Datensätze je Referenzfeld (Wert und Beschriftung). */
  options?: Record<string, { value: string; label: string }[]>;
  /** Felder vor dem Schema im selben Raster (der Slug eines Sammlungseintrags). */
  leading?: ReactNode;
  /** Bildfelder mit Ausschnitt: Pixelmaße, womit gespeichert wird, Name der Stelle. */
  media?: SchemaMedia;
}

/**
 * Baut aus dem gespeicherten Schema eine Maske: je Feld das Widget aus `.meta()`, je Abschnitt ein `FormGrid`
 * (docs/MUSTER.md § E und § J). Aufeinanderfolgende Felder mit gleichem `group` bilden einen Abschnitt mit Titel;
 * die Reihenfolge des Templates bleibt.
 */
export function SchemaForm({ schema, value, errors = {}, locales, onChange, options, leading, media }: SchemaFormProps) {
  const filled = withBlanks(schema, value, locales);
  const groups: { group: string | undefined; keys: string[] }[] = fieldGroups(schema);
  // Was vorne steht, gehört in den ersten Abschnitt ohne Titel — hat der erste einen, bekommt es einen eigenen.
  if (leading && (groups.length === 0 || groups[0]!.group !== undefined)) groups.unshift({ group: undefined, keys: [] });
  return (
    <>
      {groups.map(({ group, keys }, index) => {
        const grid = (
          <FormGrid>
            {index === 0 ? leading : null}
            {keys.map((key) => (
              <SchemaField
                key={key}
                path={key}
                field={schema[key]!}
                value={filled[key]}
                errors={errors}
                locales={locales}
                onChange={(next) => onChange({ ...filled, [key]: next })}
                options={options?.[key]}
                media={media}
              />
            ))}
          </FormGrid>
        );
        const key = `${group ?? ''}-${index}`;
        if (!group) {
          return (
            <section key={key} className={cn(index > 0 && 'mt-5 border-t border-line pt-5')}>
              {grid}
            </section>
          );
        }
        const section = (
          <Section key={key} title={group}>
            {grid}
          </Section>
        );
        // Zwei Abschnitte mit Titel hintereinander trennt `Section` selbst; nach einem ohne Titel zieht der Rahmen die Linie.
        return index > 0 && !groups[index - 1]!.group ? (
          <div key={key} className="mt-5 border-t border-line pt-5">
            {section}
          </div>
        ) : (
          section
        );
      })}
    </>
  );
}

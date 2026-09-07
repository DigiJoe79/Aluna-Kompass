'use client';

import type { FieldSchema } from '@kompass/module-site';
import { SchemaField } from './field';
import { withBlanks } from './state';

export { blankFor, setAtPath, withBlanks } from './state';

export interface SchemaFormProps {
  /** Das gespeicherte JSON-Schema je Feld — die Variablen eines Templates oder die Felder einer Sammlung. */
  schema: Record<string, FieldSchema>;
  value: Record<string, unknown>;
  errors?: Record<string, string>;
  locales: string[];
  onChange: (next: Record<string, unknown>) => void;
}

/** Baut aus dem gespeicherten Schema eine Maske: je Feld das Widget aus `.meta()`. */
export function SchemaForm({ schema, value, errors = {}, locales, onChange }: SchemaFormProps) {
  const filled = withBlanks(schema, value, locales);
  return (
    <div className="flex flex-col gap-5">
      {Object.entries(schema).map(([key, field]) => (
        <SchemaField
          key={key}
          path={key}
          field={field}
          value={filled[key]}
          errors={errors}
          locales={locales}
          onChange={(next) => onChange({ ...filled, [key]: next })}
        />
      ))}
    </div>
  );
}

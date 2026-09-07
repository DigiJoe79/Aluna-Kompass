'use client';

import { widgetOf, type FieldSchema } from '@kompass/module-site/client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FieldError } from '@/components/forms/field-error';
import { MarkdownPreview } from '@/components/markdown-preview';
import { blankFor, setAtPath } from './state';

export interface FieldProps {
  path: string;
  field: FieldSchema;
  value: unknown;
  errors: Record<string, string>;
  locales: string[];
  onChange: (next: unknown) => void;
}

const labelOf = (field: FieldSchema, path: string) => (typeof field.label === 'string' && field.label) || path;

function Localized({ path, field, value, errors, locales, onChange }: FieldProps) {
  const t = useTranslations('site.form');
  const record = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, string>;
  const leading = locales[0] ?? 'de';
  const isMarkdown = field.markdown === true;
  const tabbed = locales.length >= 4;
  const [active, setActive] = useState(leading);
  const [preview, setPreview] = useState(false);

  const cell = (locale: string) => {
    const name = `${path}.${locale}`;
    const error = errors[name] ?? (locale === leading ? errors[path] : undefined);
    const untranslated = locale !== leading && (record[leading] ?? '').length > 0 && (record[locale] ?? '').length === 0;
    const shared = {
      id: name,
      name,
      value: record[locale] ?? '',
      'aria-invalid': error ? true : undefined,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...record, [locale]: e.target.value }),
    };
    return (
      <div key={locale} className={cn('flex min-w-0 flex-col gap-1', tabbed && locale !== active && 'hidden')}>
        <span className="flex items-center gap-2 text-[11px] font-semibold text-muted-ink">
          <span className="rounded-sm bg-badge px-1.5 py-0.5 font-mono text-[10px] text-badge-ink">{locale.toUpperCase()}</span>
          {untranslated ? <span className="text-warning">{t('untranslated')}</span> : null}
        </span>
        {isMarkdown ? <Textarea {...shared} rows={5} className="font-mono text-[13px]" /> : <Input {...shared} />}
        <FieldError id={`${name}-error`} message={error} />
      </div>
    );
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[13px] font-semibold text-ink-2">{labelOf(field, path)}</legend>
      {tabbed ? (
        <div className="flex flex-wrap gap-1 border-b border-subtle pb-1">
          {locales.map((l) => (
            <button key={l} type="button" onClick={() => setActive(l)} className={cn('rounded-sm px-2 py-1 font-mono text-[10px] uppercase', active === l ? 'bg-panel-selected font-semibold text-ink' : 'text-muted-ink')}>
              {l}
            </button>
          ))}
        </div>
      ) : null}
      <div className={cn('grid gap-3', locales.length === 2 && 'md:grid-cols-2', locales.length === 3 && 'md:grid-cols-3')}>
        {locales.map(cell)}
      </div>
      {isMarkdown ? (
        <div className="flex flex-col gap-2">
          <button type="button" aria-pressed={preview} onClick={() => setPreview((p) => !p)} className="self-start rounded-sm bg-badge px-2 py-0.5 text-[11px] text-badge-ink">
            {t('preview')}
          </button>
          {preview ? <MarkdownPreview markdown={record[active] ?? record[leading] ?? ''} /> : null}
        </div>
      ) : null}
    </fieldset>
  );
}

/** Liste aus Textzeilen oder aus Datensätzen — was von beidem, sagt das Feldschema. */
function ListField({ path, field, value, errors, locales, onChange }: FieldProps) {
  const t = useTranslations('site.form');
  const items = Array.isArray(value) ? (value as unknown[]) : [];
  const itemSchema = (field.items as FieldSchema | undefined) ?? { widget: 'text' };
  const properties = (itemSchema as { properties?: Record<string, FieldSchema> }).properties;
  const objectItems = itemSchema.type === 'object' && !!properties;
  const max = typeof field.maxItems === 'number' ? field.maxItems : undefined;
  // Ein neuer Datensatz bringt seine Felder gleich mit, sonst steht die Maske leer.
  const blank = objectItems
    ? Object.fromEntries(Object.entries(properties ?? {}).map(([key, sub]) => [key, blankFor(sub, locales)]))
    : '';

  const update = (index: number, next: unknown) => onChange(items.map((it, i) => (i === index ? next : it)));
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const copy = [...items];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    onChange(copy);
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
        {labelOf(field, path)}
        {max ? <span className="text-[11px] font-normal text-muted-ink">{t('atMost', { max })}</span> : null}
      </legend>
      <ol className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-2 rounded-md border border-line p-2">
            <div className="flex-1">
              {objectItems ? (
                <div className="grid gap-2">
                  {Object.entries((itemSchema as { properties: Record<string, FieldSchema> }).properties).map(([key, sub]) => (
                    <SchemaField
                      key={key}
                      path={`${path}.${index}.${key}`}
                      field={sub}
                      value={(item as Record<string, unknown>)?.[key]}
                      errors={errors}
                      locales={locales}
                      onChange={(next) => update(index, setAtPath(item, key, next))}
                    />
                  ))}
                </div>
              ) : (
                <Input
                  name={`${path}.${index}`}
                  value={typeof item === 'string' ? item : ''}
                  onChange={(e) => update(index, e.target.value)}
                />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <button type="button" aria-label={t('moveUp')} onClick={() => move(index, -1)} className="rounded-sm bg-badge px-1.5 text-[11px] text-badge-ink">↑</button>
              <button type="button" aria-label={t('moveDown')} onClick={() => move(index, 1)} className="rounded-sm bg-badge px-1.5 text-[11px] text-badge-ink">↓</button>
              <button type="button" aria-label={t('remove')} onClick={() => onChange(items.filter((_, i) => i !== index))} className="rounded-sm bg-badge px-1.5 text-[11px] text-error">×</button>
            </div>
          </li>
        ))}
      </ol>
      {!max || items.length < max ? (
        <button type="button" onClick={() => onChange([...items, blank])} className="self-start rounded-sm border border-line px-2 py-1 text-[12px] font-semibold text-ink-2">
          {t('add')}
        </button>
      ) : null}
    </fieldset>
  );
}

export function SchemaField(props: FieldProps) {
  const { path, field, value, errors, onChange } = props;
  const widget = widgetOf(field);
  const error = errors[path];
  const label = labelOf(field, path);

  if (widget === 'localized') return <Localized {...props} />;
  if (widget === 'list' || widget === 'objectList') return <ListField {...props} />;

  const simple = (control: React.ReactNode) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={path} className="text-[13px] font-semibold text-ink-2">{label}</label>
      {control}
      <FieldError id={`${path}-error`} message={error} />
    </div>
  );

  if (widget === 'markdown') {
    return simple(
      <>
        <Textarea id={path} name={path} rows={6} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} className="font-mono text-[13px]" />
        <MarkdownPreview markdown={typeof value === 'string' ? value : ''} />
      </>,
    );
  }
  if (widget === 'number') {
    return simple(
      <Input id={path} name={path} type="number" value={value === null || value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} aria-invalid={error ? true : undefined} />,
    );
  }
  if (widget === 'select') {
    const options = ((field as { enum?: string[] }).enum ?? []) as string[];
    return simple(
      <select id={path} name={path} value={typeof value === 'string' ? value : options[0] ?? ''} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>,
    );
  }
  if (widget === 'asset') {
    return <AssetField {...props} />;
  }
  const isDate = (field as { format?: string }).format === 'date';
  return simple(
    <Input id={path} name={path} type={isDate ? 'date' : 'text'} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} />,
  );
}

function AssetField({ path, field, value, errors, onChange }: FieldProps) {
  const t = useTranslations('site.form');
  const assetId = typeof value === 'string' ? value : null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] font-semibold text-ink-2">{labelOf(field, path)}</span>
      <div className="flex items-center gap-3">
        <input type="hidden" name={path} value={assetId ?? ''} />
        {assetId ? <img src={`/media/${assetId}`} alt="" className="size-14 rounded-md border border-line object-cover" /> : <div className="size-14 rounded-md border border-dashed border-line-strong bg-surface-2" aria-hidden />}
        <Input
          aria-label={t('chooseImage')}
          value={assetId ?? ''}
          placeholder="asset-id"
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          className="max-w-xs"
        />
        {assetId ? (
          <button type="button" onClick={() => onChange(null)} className="rounded-sm bg-badge px-2 py-0.5 text-[11px] text-error">{t('removeImage')}</button>
        ) : null}
      </div>
      <FieldError id={`${path}-error`} message={errors[path]} />
    </div>
  );
}

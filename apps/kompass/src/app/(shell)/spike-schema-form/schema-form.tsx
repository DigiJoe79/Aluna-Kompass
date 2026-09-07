'use client';
// WEGWERF — Feldstudie zur Maskenerzeugung, nicht committen.

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownPreview } from '@/components/markdown-preview';

type Json = Record<string, unknown>;
type Node = Json & { type?: string; properties?: Record<string, Node>; items?: Node; enum?: string[]; widget?: string; locales?: string[]; markdown?: boolean; label?: string; itemLabel?: string; minimum?: number; maximum?: number; maxItems?: number; maxLength?: number; format?: string };

const get = (obj: unknown, path: (string | number)[]): unknown => path.reduce<unknown>((v, k) => (v == null ? v : (v as Json)[k as string]), obj);

function set(obj: unknown, path: (string | number)[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (typeof head === 'number') {
    const arr = Array.isArray(obj) ? [...obj] : [];
    arr[head] = set(arr[head], rest, value);
    return arr;
  }
  const target = (obj ?? {}) as Json;
  return { ...target, [head as string]: set(target[head as string], rest, value) };
}

/** Leerwert nach Schema — damit „Hinzufügen" nicht undefined einsetzt. */
function blank(node: Node): unknown {
  if (node.widget === 'localized') return Object.fromEntries((node.locales ?? []).map((l) => [l, '']));
  if (node.widget === 'asset') return null;
  if (node.type === 'array') return [];
  if (node.type === 'object') return Object.fromEntries(Object.entries(node.properties ?? {}).map(([k, v]) => [k, blank(v)]));
  if (node.type === 'integer' || node.type === 'number') return 0;
  if (node.enum) return node.enum[0];
  return '';
}

const labelFor = (node: Node, key: string) => node.label ?? key;

function Field({ node, path, value, onChange }: { node: Node; path: (string | number)[]; value: unknown; onChange: (path: (string | number)[], v: unknown) => void }) {
  const id = path.join('.');

  if (node.widget === 'localized') {
    const locales = node.locales ?? [];
    const text = (value ?? {}) as Record<string, string>;
    const [preview, setPreview] = useState(locales[0]!);
    return (
      <div className="flex flex-col gap-1.5 md:col-span-2">
        <span className="text-[13px] font-semibold text-ink-2">{node.label}</span>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(locales.length, 3)}, minmax(0, 1fr))` }}>
          {locales.map((l) => (
            <div key={l} className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-2 text-[12px] font-semibold text-muted-ink">
                <span className="rounded-sm bg-badge px-1.5 py-0.5 font-mono text-[10px] text-badge-ink">{l.toUpperCase()}</span>
                {l !== locales[0] && (text[locales[0]!] ?? '').length > 0 && (text[l] ?? '').length === 0 ? <span className="text-warning">fehlt</span> : null}
              </span>
              {node.markdown ? (
                <Textarea id={`${id}-${l}`} rows={5} value={text[l] ?? ''} onChange={(e) => onChange([...path, l], e.target.value)} className="font-mono text-[13px]" />
              ) : (
                <Input id={`${id}-${l}`} value={text[l] ?? ''} onChange={(e) => onChange([...path, l], e.target.value)} className="h-9" />
              )}
            </div>
          ))}
        </div>
        {node.markdown ? (
          <div className="mt-1 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-muted-ink">Vorschau</span>
              {locales.map((l) => (
                <button key={l} type="button" aria-pressed={preview === l} onClick={() => setPreview(l)} className={`rounded-sm px-2 py-0.5 font-mono ${preview === l ? 'bg-brand text-on-brand' : 'bg-badge text-badge-ink'}`}>{l.toUpperCase()}</button>
              ))}
            </div>
            <MarkdownPreview markdown={text[preview] ?? ''} />
          </div>
        ) : null}
      </div>
    );
  }

  if (node.widget === 'asset') {
    const assetId = value as string | null;
    return (
      <div className="flex items-center gap-3">
        {assetId ? <img src={`/media/${assetId}`} alt="" className="size-14 rounded-md border border-line object-cover" /> : <div className="size-14 rounded-md border border-dashed border-line-strong bg-surface-2" aria-hidden />}
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-ink-2">{node.label}</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm">Bild wählen</Button>
            {assetId ? <Button type="button" variant="ghost" size="sm" onClick={() => onChange(path, null)}>Entfernen</Button> : null}
          </div>
        </div>
      </div>
    );
  }

  if (node.type === 'array' && node.items?.type === 'object') {
    const items = (value ?? []) as unknown[];
    const move = (i: number, d: number) => {
      const next = [...items];
      const [x] = next.splice(i, 1);
      next.splice(i + d, 0, x);
      onChange(path, next);
    };
    return (
      <section className="flex flex-col gap-3 md:col-span-2">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink-2">{node.label} · {items.length}{node.maxItems ? ` / ${node.maxItems}` : ''}</span>
          <Button type="button" variant="outline" size="sm" disabled={node.maxItems !== undefined && items.length >= node.maxItems} onClick={() => onChange(path, [...items, blank(node.items!)])}>
            <Plus className="size-3.5" aria-hidden /> {node.itemLabel ?? 'Eintrag'} hinzufügen
          </Button>
        </div>
        {items.map((item, i) => (
          <article key={i} className="rounded-md border border-line bg-surface-2 p-4">
            <header className="mb-3 flex items-center justify-between">
              <h4 className="text-[13px] font-semibold">{node.itemLabel ?? 'Eintrag'} {i + 1}</h4>
              <span className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="nach oben"><ChevronUp className="size-3.5" /></Button>
                <Button type="button" variant="ghost" size="sm" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="nach unten"><ChevronDown className="size-3.5" /></Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(path, items.filter((_, j) => j !== i))} aria-label="entfernen"><Trash2 className="size-3.5 text-error" /></Button>
              </span>
            </header>
            <div className="grid gap-4 md:grid-cols-2">
              {Object.entries(node.items!.properties ?? {}).map(([k, child]) => (
                <Field key={k} node={{ ...child, label: labelFor(child, k) }} path={[...path, i, k]} value={get(item, [k])} onChange={onChange} />
              ))}
            </div>
          </article>
        ))}
      </section>
    );
  }

  if (node.type === 'array') {
    const items = (value ?? []) as string[];
    return (
      <div className="flex flex-col gap-1.5 md:col-span-2">
        <span className="text-[13px] font-semibold text-ink-2">{node.label}</span>
        {items.map((v, i) => (
          <span key={i} className="flex gap-2">
            <Input value={v} onChange={(e) => onChange([...path, i], e.target.value)} className="h-9" />
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(path, items.filter((_, j) => j !== i))}><Trash2 className="size-3.5 text-error" /></Button>
          </span>
        ))}
        <span><Button type="button" variant="outline" size="sm" disabled={node.maxItems !== undefined && items.length >= node.maxItems} onClick={() => onChange(path, [...items, ''])}><Plus className="size-3.5" aria-hidden /> hinzufügen</Button></span>
      </div>
    );
  }

  if (node.enum) {
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">{node.label}</label>
        <select id={id} value={(value as string) ?? ''} onChange={(e) => onChange(path, e.target.value)} className="h-9 rounded-md border border-line bg-surface px-3 text-[14px]">
          {node.enum.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  if (node.type === 'integer' || node.type === 'number') {
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">{node.label}</label>
        <Input id={id} type="number" min={node.minimum} max={node.maximum} step={node.type === 'integer' ? 1 : 'any'} value={String(value ?? '')} onChange={(e) => onChange(path, e.target.value === '' ? 0 : Number(e.target.value))} className="h-9 font-mono" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">{node.label}</label>
      <Input id={id} type={node.format === 'date' ? 'date' : 'text'} maxLength={node.maxLength} value={(value as string) ?? ''} onChange={(e) => onChange(path, e.target.value)} className={`h-9 ${node.format === 'date' ? 'font-mono' : ''}`} />
    </div>
  );
}

export function SchemaForm({ schema, initial }: { schema: Node; initial: Json }) {
  const [data, setData] = useState<Json>(initial);
  const onChange = (path: (string | number)[], v: unknown) => setData((d) => set(d, path, v) as Json);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-5 rounded-lg border border-line bg-surface p-5 md:grid-cols-2">
        {Object.entries(schema.properties ?? {}).map(([k, node]) => (
          <Field key={k} node={{ ...node, label: labelFor(node, k) }} path={[k]} value={get(data, [k])} onChange={onChange} />
        ))}
      </div>
      <details className="rounded-lg border border-line bg-surface-2 text-[13px]">
        <summary className="cursor-pointer p-3 font-semibold">Datensatz, wie er gespeichert würde</summary>
        <pre className="max-h-[320px] overflow-auto px-3 pb-3 font-mono text-[12px]">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}

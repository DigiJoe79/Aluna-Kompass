'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { TemplateRow } from '@/lib/document-template-rows';
import { setDocumentBaseAction } from './actions';

interface Base {
  id: string;
  label: string;
  kind: string;
  own: boolean;
  ok: boolean;
  error?: string;
}

/** Eine Dokumentart mit ihrem Namen, wie die Seite sie zeigt. */
export interface TypeRow extends TemplateRow {
  label: string;
}
export interface TypeGroup {
  module: string;
  moduleLabel: string;
  rows: TypeRow[];
}

/** Eine vom Modul genutzte Basis, die die Installation nicht selbst führt (Befund 51 b). */
interface Gap {
  base: string;
  label: string;
  module: string;
}

/**
 * Zwei getrennte Dinge, jedes mit eigener Überschrift: welche Basis-Vorlagen es gibt, und welche Dokumentart
 * auf welcher erscheint. Die zweite Tabelle nennt die wirksame Basis und zeigt eine Abweichung von der Vorgabe
 * als solche – vorher stand dort nur „Vorgabe der Vorlage“, und eine alte Übersteuerung blieb unbemerkt
 * (Befund vom 2026-09-30).
 */
export function BasesPanel({ bases, groups, gaps = [], canManage }: { bases: Base[]; groups: TypeGroup[]; gaps?: Gap[]; canManage: boolean }) {
  const t = useTranslations('documents.bases');
  const router = useRouter();
  const [pending, start] = useTransition();
  const usable = bases.filter((b) => b.ok);

  const setBase = (key: string, baseId: string | null) =>
    start(async () => {
      const s = await setDocumentBaseAction(key, baseId);
      if (s.status === 'error') toast.error(s.message);
      else if (s.status === 'success') {
        toast.success(s.message ?? '');
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-5">
      {gaps.length > 0 ? (
        <div role="note" data-testid="base-gaps" className="rounded-lg border border-warning bg-warning-bg px-4 py-3 text-[13px] text-ink">
          <p className="font-semibold">{t('gapsTitle')}</p>
          <p className="mt-1 text-ink-2">{t('gapsText')}</p>
          <ul className="mt-1 list-disc pl-5">
            {gaps.map((gap) => (
              <li key={`${gap.module}-${gap.base}`}>{t('gap', { label: gap.label, base: gap.base, module: gap.module })}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section aria-labelledby="bases-heading" className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line-2 px-4 py-3">
          <h2 id="bases-heading" className="text-[14px] font-semibold">{t('title')}</h2>
          <p className="mt-0.5 text-[13px] text-ink-2">{t('intro')}</p>
        </div>
        <table className="w-full text-[13px]">
          <thead className="text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
            <tr className="h-9">
              <th className="px-4">{t('columns.base')}</th>
              <th className="px-4">{t('columns.id')}</th>
              <th className="px-4">{t('columns.origin')}</th>
              <th className="px-4">{t('columns.state')}</th>
            </tr>
          </thead>
          <tbody>
            {bases.map((b) => (
              <tr key={b.id} className="h-10 border-t border-line-2">
                <td className="px-4">{b.label}</td>
                <td className="px-4 font-mono text-[12px] text-ink-2">{b.id}</td>
                <td className="px-4">
                  <StatusBadge tone={b.own ? 'brand' : 'neutral'}>{b.own ? t('own') : t('shipped')}</StatusBadge>
                </td>
                <td className="px-4">
                  <StatusBadge tone={b.ok ? 'success' : 'error'}>{b.ok ? t('ready') : t('broken')}</StatusBadge>
                  {b.error ? <span className="ml-2 text-[11px] text-error" title={b.error}>{b.error}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="types-heading" className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line-2 px-4 py-3">
          <h2 id="types-heading" className="text-[14px] font-semibold">{t('typesTitle')}</h2>
          <p className="mt-0.5 text-[13px] text-ink-2">{t('typesIntro')}</p>
        </div>
        <table className="w-full text-[13px]">
          <thead className="text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
            <tr className="h-9">
              <th className="px-4">{t('columns.type')}</th>
              <th className="px-4">{t('columns.effective')}</th>
              <th className="px-4">{t('columns.choice')}</th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.module}>
              <tr className="border-t border-line-2 bg-surface-2">
                <th colSpan={3} scope="colgroup" className="px-4 py-1.5 text-left text-[12px] font-semibold text-ink-2">{group.moduleLabel}</th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.key} className="border-t border-line-2 [&>*]:py-2.5">
                  <th scope="row" className="px-4 text-left font-normal">
                    <span className="block">{row.label}</span>
                    {row.label === row.key ? null : <span className="block font-mono text-[11px] text-muted-ink">{row.key}</span>}
                  </th>
                  <td className="px-4" data-testid="effective-base">
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{row.effectiveLabel}</span>
                      <span className="font-mono text-[11px] text-ink-2">{row.effectiveBase}</span>
                      {row.override ? <StatusBadge tone="warning">{t('overridden')}</StatusBadge> : null}
                      {row.available ? null : <StatusBadge tone="error">{t('unavailable')}</StatusBadge>}
                    </span>
                  </td>
                  <td className="px-4">
                    <span className="flex items-center gap-2">
                      <Select
                        aria-label={t('choiceFor', { type: row.label })}
                        value={row.override ?? ''}
                        disabled={!canManage || pending}
                        className="w-auto"
                        onChange={(e) => setBase(row.key, e.target.value || null)}
                      >
                        <option value="">{t('useDefault', { base: row.defaultBase })}</option>
                        {/* Eine Übersteuerung auf eine Basis, die es nicht mehr gibt, bleibt wählbar sichtbar – sonst zeigte das Feld die Vorgabe. */}
                        {row.override && !usable.some((b) => b.id === row.override) ? <option value={row.override}>{row.override}</option> : null}
                        {usable.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label} ({b.id})
                          </option>
                        ))}
                      </Select>
                      {row.override && canManage ? (
                        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setBase(row.key, null)}>
                          {t('reset')}
                        </Button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </section>
    </div>
  );
}

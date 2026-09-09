'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setDocumentBaseAction } from './actions';

interface Base {
  id: string;
  label: string;
  kind: string;
  ok: boolean;
  error?: string;
}
interface TypeRow {
  key: string;
  label: string;
  base: string;
  isDefault: boolean;
}

export function BasesPanel({ bases, types, canManage }: { bases: Base[]; types: TypeRow[]; canManage: boolean }) {
  const t = useTranslations('documents.bases');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();

  return (
    <section className="mb-5 rounded-lg border border-line bg-surface">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-3 text-[14px] font-semibold">
        {t('title')}
        <span className="text-ink-2">{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <div className="border-t border-line-2 px-4 py-3 text-[13px]">
          <ul className="mb-4 flex flex-col gap-1">
            {bases.map((b) => (
              <li key={b.id} className="flex items-center gap-2">
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${b.ok ? 'bg-success-bg text-success' : 'bg-error-bg text-error'}`}>
                  {b.ok ? t('ready') : t('broken')}
                </span>
                <span>{b.label}</span>
                <span className="font-mono text-[11px] text-ink-2">{b.id}</span>
                {b.error ? <span className="truncate text-[11px] text-error" title={b.error}>{b.error}</span> : null}
              </li>
            ))}
          </ul>
          <table className="w-full">
            <tbody>
              {types.map((row) => (
                <tr key={row.key} className="h-9">
                  <td className="text-ink-2">{row.label}</td>
                  <td className="text-right">
                    <select
                      value={row.isDefault ? '' : row.base}
                      disabled={!canManage}
                      className="rounded border border-line bg-input px-1 py-0.5 text-[13px]"
                      onChange={(e) =>
                        start(async () => {
                          const s = await setDocumentBaseAction(row.key, e.target.value || null);
                          if (s.status === 'error') toast.error(s.message);
                          else if (s.status === 'success') {
                            toast.success(s.message ?? '');
                            router.refresh();
                          }
                        })
                      }
                    >
                      <option value="">{t('useDefault')}</option>
                      {bases.filter((b) => b.ok).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

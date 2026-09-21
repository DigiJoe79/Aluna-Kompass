'use client';

import { AlertTriangle, ArrowRight, Info, OctagonAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface NoticeReason {
  name: string;
  value?: string;
  onChange: (value: string) => void;
  label: string;
}

export interface NoticeRemedy {
  label: string;
  onSelect?: () => void;
  href?: string;
}

export interface NoticeProps {
  level: 'hint' | 'warn' | 'refuse';
  title?: string;
  children: ReactNode;
  /** Nur `level="warn"`: Pflichtbegründung *im* Kasten. Ohne sie ist die Warnung eine reine Meldung. */
  reason?: NoticeReason;
  /** Nur `level="warn"` ohne `reason`: ein Angebot statt eines Textfelds (z. B. „Rest aus freien Mitteln“). */
  action?: ReactNode;
  /** Nur `level="refuse"`: ein bis drei Auswege, der wahrscheinlichste zuerst. */
  remedies?: NoticeRemedy[];
}

const ROLE: Record<NoticeProps['level'], 'status' | 'alert' | undefined> = {
  hint: undefined,
  warn: 'status',
  refuse: 'alert',
};

/**
 * Drei Meldungsstufen, die sich in Rahmen, Fläche und Bau unterscheiden, nicht
 * nur in der Farbe (HANDOFF § 2.6). `refuse` nennt den Grund und bis zu drei
 * Auswege — nie das Wort „Fehler“.
 */
export function Notice({ level, title, children, reason, action, remedies }: NoticeProps) {
  const t = useTranslations('common.notice');
  return (
    <div
      role={ROLE[level]}
      className={cn(
        'rounded-md border p-3 text-[13px]',
        level === 'hint' && 'border-line bg-surface',
        level === 'warn' && 'border-warning bg-warning-bg',
        level === 'refuse' && 'border-error bg-error-bg',
      )}
    >
      <div className="flex gap-2.5">
        {level === 'hint' && <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />}
        {level === 'warn' && <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
        {level === 'refuse' && <OctagonAlert className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />}
        <div className="flex-1 space-y-2">
          {title ? <p className="font-semibold text-ink">{title}</p> : null}
          <div className="text-ink-2">{children}</div>

          {level === 'warn' && reason ? (
            <div className="pt-1">
              <label htmlFor={reason.name} className="mb-1 block text-[12px] font-semibold text-ink">
                {reason.label}
              </label>
              <textarea
                id={reason.name}
                name={reason.name}
                required
                value={reason.value}
                onChange={(e) => reason.onChange(e.target.value)}
                className="w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[13px]"
                rows={2}
              />
            </div>
          ) : null}

          {level === 'warn' && !reason && action ? <div className="pt-1">{action}</div> : null}

          {level === 'refuse' && remedies && remedies.length > 0 ? (
            <div className="pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-ink">{t('waysOut')}</p>
              <ul className="mt-1.5 space-y-1.5">
                {remedies.map((remedy, index) => {
                  const strong = index === 0;
                  const content = (
                    <span className={cn('flex items-center gap-2 rounded-sm border px-2.5 py-1.5', strong ? 'border-error bg-surface' : 'border-line bg-surface')}>
                      <ArrowRight className="size-3.5 shrink-0 text-ink-2" aria-hidden />
                      <span className="text-ink">{remedy.label}</span>
                    </span>
                  );
                  return (
                    <li key={remedy.label}>
                      {remedy.href ? (
                        <a href={remedy.href}>{content}</a>
                      ) : (
                        <button type="button" onClick={remedy.onSelect} className="w-full text-left">
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

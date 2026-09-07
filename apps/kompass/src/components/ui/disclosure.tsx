'use client';

import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Ergebnisblock, der zugeklappt anfängt. Auf der Publizieren-Seite werden
 * Listen sonst beliebig lang — Übersetzungslücken betreffen heute den ganzen
 * englischen Baum, und die Dateiliste eines Publish hat Hunderte Einträge.
 *
 * Auf <details> gebaut: kein eigener Zustand, ohne JavaScript benutzbar, und
 * der Inhalt bleibt im Dokument, auch wenn er zugeklappt ist.
 */
export function Disclosure({
  label,
  count,
  tone = 'neutral',
  alarm = false,
  defaultOpen = false,
  empty,
  children,
}: {
  label: string;
  /** Weggelassen, wo eine Zahl nichts sagt — etwa bei einem Protokoll. */
  count?: number;
  tone?: 'neutral' | 'error' | 'warning' | 'success';
  /** Roter Rahmen: nur, wo der Inhalt eine Veröffentlichung verhindert. */
  alarm?: boolean;
  defaultOpen?: boolean;
  /** Text statt Inhalt, wenn es nichts zu zeigen gibt. */
  empty?: string;
  children?: ReactNode;
}) {
  const toneClass =
    tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : '';
  const frameClass = alarm ? 'border-error bg-error-bg' : 'border-line bg-surface-2';

  const suffix = count === undefined ? '' : ` · ${count}`;

  if (count === 0 && empty) {
    return (
      <section aria-label={label} className={`rounded-md border ${frameClass} p-3 text-[13px]`}>
        <h4 className={`font-semibold ${toneClass}`}>{label} · 0</h4>
        <p className="text-muted-ink">{empty}</p>
      </section>
    );
  }

  return (
    <section aria-label={label} className={`rounded-md border ${frameClass} text-[13px]`}>
      <details open={defaultOpen} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-3 font-semibold">
          <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
          {alarm ? <AlertTriangle className="size-4 shrink-0 text-error" aria-hidden /> : null}
          <span className={toneClass}>
            {label}
            {suffix}
          </span>
        </summary>
        <div className="max-h-[240px] overflow-auto px-3 pb-3">{children}</div>
      </details>
    </section>
  );
}

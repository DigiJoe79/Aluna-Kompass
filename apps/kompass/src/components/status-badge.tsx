import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Töne einer Marke. `accent` gehört nicht dazu: Er sah im Standard-Theme fast aus wie `error`; Marken stehen auf
 * `brand` oder `neutral` (Designer Stufe 2 Nr. 6b). Das Token `color-accent` selbst bleibt für andere Stellen.
 */
export type BadgeTone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'brand' | 'final' | 'agent';

/**
 * Die eine Tontabelle Status → Ton (Designer Stufe 2 Nr. 6f). Wer einen Zustand als Marke zeigt, liest den Ton von
 * hier; lokale Tabellen hält der Wächter `patterns/status-tones.test.ts` fern. Je Art die Zustände in fachlicher
 * Reihenfolge. In Listen zeigt der Normalzustand keine Marke (`isNormalInList`), im Seitenkopf steht er immer.
 */
export const STATUS_TONES = {
  /** Buchung (Wörterbuch HANDOFF § 2). */
  entry: { draft: 'warning', reviewed: 'info', reversed: 'neutral', final: 'final' },
  /** Auslage: abgelehnt ist `error` (Designer Stufe 2 Nr. 6c). */
  claim: { draft: 'warning', submitted: 'info', approved: 'success', paid: 'final', rejected: 'error' },
  /** Ergebnis einer Freigabe (Zahlung an Partner, Umwidmung). */
  decision: { approved: 'success', rejected: 'neutral' },
  animal: { lookingForHome: 'info', reserved: 'warning', adopted: 'success' },
  purpose: { open: 'info', fulfilled: 'success', dissolved: 'neutral' },
  /** Zweck in der Einrichtung (offen ist der Normalzustand). */
  purposeSetup: { open: 'success', fulfilled: 'neutral', dissolved: 'neutral' },
  limit: { calm: 'neutral', near: 'warning', exceeded: 'error', reached: 'success' },
  notice: { valid: 'success', endsOn: 'warning', expired: 'neutral', superseded: 'neutral', supersededByFinal: 'neutral', voided: 'neutral', future: 'neutral' },
  confirmation: { valid: 'success', toCorrect: 'warning', voided: 'neutral' },
  confirmationRun: { running: 'info', withFailures: 'warning', finished: 'success' },
  document: { draft: 'warning', issued: 'success', voided: 'error' },
  user: { active: 'success', firstLoginPending: 'warning', inactive: 'neutral' },
  /** Aktiv/inaktiv eines Stammdatums (Konto, Kategorie, Dokumentart, Regel). */
  active: { active: 'success', inactive: 'neutral' },
  /** Kanal im Protokoll: ein Agent trägt den Ton der Agenten (wie „von Agent vorbereitet“). */
  auditChannel: { ui: 'info', mcp: 'agent', system: 'neutral' },
  workRow: { open: 'neutral', proposed: 'info', booked: 'final' },
  /** Hochgeladener Auszug: fehlgeschlagen ist `error` (07-1 A6). */
  importRun: { finished: 'neutral', failed: 'error', discarded: 'neutral' },
  /** Rollen (Nutzer, Kontakte) sind neutral (Designer Stufe 2 Nr. 6e). */
  role: { current: 'neutral', ended: 'neutral' },
} as const satisfies Record<string, Record<string, BadgeTone>>;

export type StatusKind = keyof typeof STATUS_TONES;

export function statusTone<K extends StatusKind>(kind: K, status: keyof (typeof STATUS_TONES)[K]): BadgeTone {
  return (STATUS_TONES[kind] as Record<PropertyKey, BadgeTone>)[status]!;
}

/**
 * Normalzustand je Art: In Listen bleibt die Zelle dafür leer, die Filter bleiben (Designer Stufe 2 Nr. 6a:
 * „Festgeschrieben“ 68 von 71, „Aktiv“ 39-mal). Im Seitenkopf (`PageHeader status`) steht er trotzdem.
 */
const NORMAL_IN_LIST: { [K in StatusKind]?: readonly (keyof (typeof STATUS_TONES)[K])[] } = {
  entry: ['final'],
  user: ['active'],
  active: ['active'],
  purpose: ['open'],
  purposeSetup: ['open'],
  notice: ['valid'],
  confirmation: ['valid'],
  confirmationRun: ['finished'],
  document: ['issued'],
  importRun: ['finished'],
};

export function isNormalInList<K extends StatusKind>(kind: K, status: keyof (typeof STATUS_TONES)[K]): boolean {
  return ((NORMAL_IN_LIST[kind] ?? []) as readonly PropertyKey[]).includes(status);
}

const TONES: Record<BadgeTone, string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  error: 'bg-error-bg text-error',
  info: 'bg-info-bg text-info',
  neutral: 'bg-badge text-badge-ink',
  brand: 'bg-brand-soft text-brand-ink',
  final: 'bg-final-bg text-final',
  agent: 'bg-agent-bg text-agent',
};

/** `dot` und `icon` schließen sich aus: Eine Marke trägt höchstens ein Zeichen vor dem Text. */
type Mark = { dot?: boolean; icon?: never } | { dot?: never; icon?: LucideIcon };

/**
 * `testId`: Kennung für Tests (`data-testid` an der Marke). `stamp`: Stempel auf einem Foto (Wischkarte) — 15/600,
 * Rahmen 2 px in der Tonfarbe, Schatten; auf dem Bild trägt die normale Marke nicht (Designer 2026-10-11, § 14).
 */
export function StatusBadge({ tone, dot, icon: Icon, children, className, testId, stamp }: { tone: BadgeTone; children: React.ReactNode; className?: string; testId?: string; stamp?: boolean } & Mark) {
  const shape = stamp ? 'rounded-md border-2 border-current px-3 py-1.5 text-section shadow-sm' : 'rounded-sm px-2 py-0.5 text-hint';
  return (
    <span data-testid={testId} className={cn('inline-flex items-center gap-1.5', shape, 'font-semibold', TONES[tone], className)}>
      {dot ? <span className="size-[7px] rounded-full bg-current" aria-hidden /> : null}
      {Icon ? <Icon className="size-3 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  );
}

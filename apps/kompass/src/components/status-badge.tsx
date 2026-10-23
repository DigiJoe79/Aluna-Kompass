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
  /** Ergebnis einer Freigabe (Zahlung an Partner, Umwidmung): abgelehnt ist überall `error` (Runde 3, Kleinpunkt 3). */
  decision: { approved: 'success', rejected: 'error' },
  /** „Sucht ein Zuhause“ ist der Normalfall in der Vermittlung (in Listen ohne Marke), „Reserviert“ `info` (Runde 3, Kleinpunkt 6). */
  animal: { lookingForHome: 'info', reserved: 'info', adopted: 'success' },
  purpose: { open: 'info', fulfilled: 'success', dissolved: 'neutral' },
  /** Bestand eines Zwecks: im Minus ist ein Fehler, erfüllt mit Rest ist Arbeit (umwidmen) (Runde 3, 120). */
  purposeBalance: { negative: 'error', fulfilledWithRest: 'warning' },
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
  /** Offene Zahlung (07-2 B10): überfällig ist eine zweite Marke neben dem Zustand; offen ist der Normalzustand. */
  openItem: { open: 'neutral', partlyPaid: 'info', settled: 'success', settledWithoutPayment: 'neutral', overdue: 'warning', draftSettlement: 'info' },
  /** Hochgeladener Auszug: fehlgeschlagen ist `error` (07-1 A6). */
  importRun: { finished: 'neutral', failed: 'error', discarded: 'neutral' },
  /** Rollen (Nutzer, Kontakte) sind neutral (Designer Stufe 2 Nr. 6e). */
  role: { current: 'neutral', ended: 'neutral' },
  /** Mitgliedschaft (Handoff Mitglieder D2, N1): „Antrag offen“ ist ein Zwischenstand, „endet am …“ Arbeit. */
  membership: { applied: 'info', active: 'success', ending: 'warning', ended: 'neutral', rejected: 'error' },
  /** Beitrag (D2): überfällig ist eine zweite Marke wie bei `openItem`; eine Mahnstufe ersetzt sie (`dunning`). */
  fee: { open: 'neutral', partlyPaid: 'info', paid: 'success', waived: 'neutral', overdue: 'warning' },
  /** Mahnstufe (D2): jede Stufe vor der letzten ist Arbeit, die letzte `error`. Das Wort ist der Name aus den Einstellungen. */
  dunning: { level: 'warning', lastLevel: 'error' },
  /** Mandat (D2): „Unterschrift fehlt“ ist Arbeit; abgelaufen ist `neutral`, die Arbeit steht dann am Mitglied. */
  mandate: { pending: 'warning', active: 'success', ended: 'neutral', expired: 'neutral' },
  /** Einzug (D2): angelegt ist Arbeit, Datei und eingereicht sind Zwischenstände, gebucht ist festgeschrieben; verworfen beendet. */
  debitRun: { draft: 'warning', fileCreated: 'info', submitted: 'info', booked: 'final', expired: 'warning', cancelled: 'neutral' },
  /** Rückgabe einer Lastschrift (D2): offen ist ein Fehler, der eine Entscheidung braucht. */
  debitReturn: { open: 'error', resolved: 'neutral' },
  /** Dauerspenden-Zusage (D2): ruhend und beendet sind gedämpfte Zeilen. */
  pledge: { active: 'success', paused: 'neutral', ended: 'neutral' },
  /** Rate einer Zusage (Nachtrag Phase 2 § 2): gebucht ist eine Buchung (`final`), zurückgegeben wie „Rückgabe zu klären“. */
  pledgeRate: { expected: 'neutral', inRun: 'info', booked: 'final', returned: 'error', skipped: 'neutral', missed: 'neutral' },
  /** Ausgang der Mails (Handoff Phase 2b § 1): wartet und wird gesendet teilen `info`, gesperrt ist Einrichtung (`warning`). */
  outbox: { queued: 'info', sending: 'info', sent: 'success', failed: 'error', blocked: 'warning', withdrawn: 'neutral' },
  /** Prüfung eines Backups (N3, Freigabe Joe 2026-10-23); „festgehalten“ ist kein Zustand der Prüfung und steht als `neutral` ohne Tabelle. */
  backupCheck: { verified: 'success', failed: 'error' },
} as const satisfies Record<string, Record<string, BadgeTone>>;

export type StatusKind = keyof typeof STATUS_TONES;

export function statusTone<K extends StatusKind>(kind: K, status: keyof (typeof STATUS_TONES)[K]): BadgeTone {
  return (STATUS_TONES[kind] as Record<PropertyKey, BadgeTone>)[status]!;
}

/**
 * Normalzustand je Art: In Listen bleibt die Zelle dafür leer, die Filter bleiben (Designer Stufe 2 Nr. 6a:
 * „Festgeschrieben“ 68 von 71, „Aktiv“ 39-mal). Im Seitenkopf (`PageHeader status`) eines Vorgangs steht er trotzdem;
 * bei Stammdaten (Kontakt, Partner, Tier) nur die Abweichung (Runde 3, Kleinpunkt 4).
 */
const NORMAL_IN_LIST: { [K in StatusKind]?: readonly (keyof (typeof STATUS_TONES)[K])[] } = {
  entry: ['final'],
  // Ausgezahlt ist der Endzustand einer Auslage; die Karte nennt ihn im Satz (Runde 3, 100).
  claim: ['paid'],
  animal: ['lookingForHome'],
  user: ['active'],
  active: ['active'],
  purpose: ['open'],
  purposeSetup: ['open'],
  // Kein `notice`: Bei Bescheiden ist „gültig“ die Auskunft, die man sucht — über die Jahre gibt es genau einen
  // gültigen und viele ersetzte oder abgelaufene (Joe 11.7). Bestätigung „gültig“ bleibt Normalzustand: Dort ist die
  // Liste lang und fast alles gültig.
  confirmation: ['valid'],
  confirmationRun: ['finished'],
  // Im Protokoll ist die Oberfläche der Normalfall; Agent und System tragen ihre Marke (Runde 3, 183).
  auditChannel: ['ui'],
  document: ['issued'],
  importRun: ['finished'],
  openItem: ['open'],
  membership: ['active'],
  fee: ['open', 'paid'],
  mandate: ['active'],
  debitRun: ['booked'],
  debitReturn: ['resolved'],
  pledge: ['active'],
  // „erwartet“ trägt in der Ratenliste eine Marke: Sie unterscheidet die künftige von der gebuchten Zeile (Nachtrag § 2).
  pledgeRate: ['booked'],
  outbox: ['sent'],
  backupCheck: ['verified'],
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

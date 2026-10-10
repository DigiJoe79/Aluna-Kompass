'use client';

import type { MouseEvent, ReactNode } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

export type CompareSide = 'current' | 'proposal';

/**
 * Die Wahlzeile der Gegenüberstellung (Freigabe Designer 2026-10-10, Board Vorschläge Artboard 2): zwei Flächen
 * „Heute“ / „Vorschlag“, man wählt eine Seite, keinen Knopf. Ganze Fläche klickbar, Pfeiltasten über die
 * Radiogruppe. Bewusst kein `label` um die Fläche: Darin stehen Knöpfe und Links (Konfliktkasten, Zweifelsfall), und
 * ein Label mit Bedienelementen darin wählt bei jedem Klick mit und gibt der Wahl einen überlangen Namen (M7). Der
 * Klick auf die Fläche wählt, außer er trifft ein eigenes Bedienelement; gewählt mit Rahmen `border-brand` und Fläche `bg-selected`. Ab 560 px Behälterbreite nebeneinander,
 * darunter untereinander; das Etikett steht in beiden Breiten in der Fläche (Board 3a).
 */
export function ChoiceCompare({
  label,
  value,
  onValueChange,
  current,
  proposed,
  currentExtra,
  proposedExtra,
  labels,
  disabled,
  testId,
}: {
  /** Feldname, zugänglicher Name der Gruppe. */
  label: string;
  value: CompareSide;
  onValueChange: (value: CompareSide) => void;
  current: ReactNode;
  proposed: ReactNode;
  /** Unter „Heute“ (Konfliktkasten). */
  currentExtra?: ReactNode;
  /** Unter „Vorschlag“ (Zweifelsfall). */
  proposedExtra?: ReactNode;
  labels: { current: string; proposal: string };
  disabled?: boolean;
  testId?: string;
}) {
  const choose = (e: MouseEvent<HTMLDivElement>, key: CompareSide) => {
    if (disabled) return;
    // Das Radio wählt selbst; Knöpfe, Links und Felder in der Fläche tun ihr Eigenes.
    if ((e.target as Element).closest('button, a, input, select, textarea, [role="radio"]')) return;
    onValueChange(key);
  };
  const side = (key: CompareSide, title: string, body: ReactNode, extra?: ReactNode) => {
    const chosen = value === key;
    return (
      // Die Maus wählt über die ganze Fläche; Tastatur und Vorleser über das Radio der Gruppe, darum kein role/tabIndex hier.
      <div
        data-side={key}
        data-chosen={chosen ? '' : undefined}
        onClick={(e) => choose(e, key)}
        className={cn(
          'flex min-w-0 flex-col gap-1.5 rounded-md border p-3',
          chosen ? 'border-brand bg-selected' : 'border-line bg-surface',
          disabled ? 'cursor-default' : 'cursor-pointer',
        )}
      >
        <span className="flex items-center gap-2">
          <RadioGroupItem value={key} aria-label={title} disabled={disabled} />
          <span className="text-hint font-semibold uppercase tracking-wide text-muted-ink">{title}</span>
        </span>
        <span className="min-w-0 break-words text-body text-ink">{body}</span>
        {extra}
      </div>
    );
  };
  return (
    <div className="@container min-w-0" data-testid={testId}>
      <RadioGroup aria-label={label} value={value} onValueChange={(v) => onValueChange(v as CompareSide)} disabled={disabled} className="grid grid-cols-1 gap-2 @[560px]:grid-cols-2">
        {side('current', labels.current, current, currentExtra)}
        {side('proposal', labels.proposal, proposed, proposedExtra)}
      </RadioGroup>
    </div>
  );
}

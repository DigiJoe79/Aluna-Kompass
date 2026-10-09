'use client';

import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Ref } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** `reversible`: Archivieren, Wieder aktivieren. `undoing`: Stornieren, Zurückziehen, Ersetzen, Beenden. `delete`: Löschen. */
export type RecordActionKind = 'reversible' | 'undoing' | 'delete';

export type RecordAction = {
  key: string;
  /** Mit „…“, wenn ein Dialog folgt. */
  label: string;
  kind: RecordActionKind;
  /** Öffnet den (gesteuerten) Dialog oder führt die umkehrbare Aktion aus. */
  onSelect: () => void;
  hidden?: boolean;
  testId?: string;
};

const ORDER: Record<RecordActionKind, number> = { reversible: 0, undoing: 1, delete: 2 };

/** Feste Reihenfolge (Designer 2026-10-08): umkehrbar → rückgängig machend → Löschen zuletzt; `hidden` fällt weg. */
export function orderRecordActions(actions: readonly RecordAction[]): RecordAction[] {
  return actions
    .filter((action) => !action.hidden)
    .map((action, index) => ({ action, index }))
    .sort((x, y) => ORDER[x.action.kind] - ORDER[y.action.kind] || x.index - y.index)
    .map(({ action }) => action);
}

/**
 * Seltene Aktionen am ganzen Datensatz (MUSTER § C, Spec Seitenkopf § 3): im Seitenkopf als Menü ⋯ „Weitere
 * Aktionen“ — auch bei nur einem Eintrag, damit dieselbe Art Aktion überall am selben Ort steht. Im Fuß von Dialog
 * und Seitenfenster (`single="button"`) wird ein einzelner Eintrag ein Knopf, ab zwei das Menü. Einträge sind nie
 * rot; die Folge erklärt der Bestätigungsdialog. Ohne sichtbaren Eintrag kein Knopf.
 *
 * `triggerRef`: Das Menü ist zu, wenn der Dialog aus einem Eintrag aufgeht. Die Seite gibt den Auslöser deshalb als
 * `finalFocus` an ihre Dialoge, damit der Fokus nach dem Schließen auf ⋯ zurückkehrt (Designer 2026-10-08).
 */
export function RecordActions({
  actions,
  label,
  single = 'menu',
  testId,
  triggerRef,
}: {
  actions: readonly RecordAction[];
  label?: string;
  single?: 'menu' | 'button';
  testId?: string;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const t = useTranslations('common');
  const visible = orderRecordActions(actions);
  if (visible.length === 0) return null;
  if (single === 'button' && visible.length === 1) {
    const only = visible[0]!;
    return (
      <Button ref={triggerRef} type="button" variant="ghost" onClick={only.onSelect} data-testid={only.testId}>
        {only.label}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label ?? t('moreActions')}
            data-testid={testId}
            // Klickfläche 44 px (HANDOFF Konsistenz § 8d.2): 38 px Feldhöhe plus 3 px rundum.
            className="relative after:absolute after:-inset-[3px]"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {visible.map((action) => (
          <DropdownMenuItem key={action.key} onSelect={action.onSelect} data-testid={action.testId}>
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

'use client';

import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Fragment, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export type RowMenuItem = {
  key: string;
  /** Verb im Infinitiv, mit „…“, wenn ein Dialog folgt („Bearbeiten“, „Löschen …“). */
  label: string;
  /** Öffnet den (gesteuerten) Dialog oder führt die Aktion aus; alternativ `href`. */
  onSelect?: () => void;
  href?: string;
  /** `delete` steht zuletzt, durch eine Linie getrennt. */
  kind?: 'action' | 'delete';
  /** Fachlich gerade nicht möglich: Der Eintrag bleibt sichtbar und nennt den Grund (MUSTER § C, „Keine Sperre ohne Grund“). */
  disabledReason?: string;
  hidden?: boolean;
  testId?: string;
};

/**
 * Zeilenaktionen einer Liste (Joe 11.8, Designer Runde 3 Teil 1 Nr. 2; MUSTER § G): immer im Menü ⋯, auf allen
 * Breiten, auch bei einer Aktion — man braucht sie selten, und die Zeile wird ruhig. Der Name in der Titelspalte
 * öffnet den Eintrag (`RowLink`/`RowButton`), das Menü bietet Bearbeiten, Deaktivieren, Löschen, wie die Zeile es
 * erlaubt. Ausgenommen sind Werte (Schalter, Kästchen), das × in Unterlisten von Formularen und Knöpfe, die die
 * Arbeit der Liste sind („Prüfen“, „Zu Buchung machen“, „Endsaldo nachtragen“, „Anschrift ergänzen“).
 *
 * Für Vorleser heißt der Knopf „Aktionen für ‹Name›“; das Menü ist per Tastatur bedienbar (Base UI Menu). Der
 * Spaltenkopf darüber ist nur für Vorleser da (`sr-only`, 112). `triggerRef` geht als `finalFocus` an einen Dialog,
 * der aus einem Eintrag aufgeht (wie bei `RecordActions`).
 */
export function RowMenu({
  name,
  items,
  testId,
  triggerRef,
}: {
  name: string;
  items: readonly RowMenuItem[];
  testId?: string;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const t = useTranslations('common');
  const visible = items.filter((item) => !item.hidden);
  if (visible.length === 0) return null;
  const actions = visible.filter((item) => item.kind !== 'delete');
  const deletes = visible.filter((item) => item.kind === 'delete');
  const entry = (item: RowMenuItem) => (
    <DropdownMenuItem
      key={item.key}
      onSelect={item.onSelect}
      disabledReason={item.disabledReason}
      data-testid={item.testId}
      render={item.href && !item.disabledReason ? <Link href={item.href} /> : undefined}
    >
      {item.label}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('rowActions', { name })}
            data-testid={testId}
            // Klickfläche 44 px wie im Seitenkopf (HANDOFF Konsistenz § 8d.2).
            className="relative after:absolute after:-inset-[3px]"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {actions.map(entry)}
        {deletes.length > 0 ? (
          <Fragment>
            {actions.length > 0 ? <DropdownMenuSeparator /> : null}
            {deletes.map(entry)}
          </Fragment>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

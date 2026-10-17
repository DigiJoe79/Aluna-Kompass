'use client';

import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { createContext, Fragment, type ReactNode, type Ref, useContext, useSyncExternalStore } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

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
  // Am Telefon kommen die Nebenaktionen des Seitenkopfs (`PageHeader more`) oben in dasselbe Menü (018). Nur im Kopf
  // (`single="menu"`), nie im Fuß eines Dialogs, auch wenn der Dialog im Baum unter dem Kopf hängt.
  const more = useContext(HeaderMoreContext);
  const phone = usePhone();
  const extra = single === 'menu' && phone ? more : [];
  if (visible.length === 0) return null;
  if (single === 'button' && visible.length === 1) {
    const only = visible[0]!;
    return (
      <Button ref={triggerRef} type="button" variant="outline" onClick={only.onSelect} data-testid={only.testId}>
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
            data-record-actions
            // Klickfläche 44 px (HANDOFF Konsistenz § 8d.2): 38 px Feldhöhe plus 3 px rundum.
            className="relative after:absolute after:-inset-[3px]"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {extra.length > 0 ? (
          <Fragment>
            {extra.map(headerMenuItem)}
            <DropdownMenuSeparator />
          </Fragment>
        ) : null}
        {visible.map((action) => (
          <DropdownMenuItem key={action.key} onSelect={action.onSelect} data-testid={action.testId}>
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Nebenaktion im Seitenkopf (`PageHeader more`; Runde 3, 018, Joe 2026-10-17): ab `sm` ein `outline`-Knopf vor den
 * Aktionen, am Telefon ein Eintrag im ⋯ — im ⋯ von `RecordActions`, falls die Seite eines hat, sonst in einem eigenen.
 * Ziel (`href`) aus Server-Seiten; ein Auslöser (`onSelect`, öffnet etwa einen gesteuerten Dialog) nur aus
 * Client-Komponenten, weil eine Funktion nicht über die Grenze geht.
 */
export type HeaderAction = {
  key: string;
  /** Mit „…“, wenn ein Dialog folgt. */
  label: string;
  href?: string;
  onSelect?: () => void;
  /** Symbol vor der Beschriftung, nur im Knopf (ab `sm`). */
  icon?: ReactNode;
  disabled?: boolean;
  hidden?: boolean;
  testId?: string;
};

const HeaderMoreContext = createContext<readonly HeaderAction[]>([]);

const PHONE = '(max-width: 639.98px)';
function subscribePhone(onChange: () => void): () => void {
  const query = typeof window.matchMedia === 'function' ? window.matchMedia(PHONE) : null;
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}
/** Telefon (`max-sm`) — gelesen erst im offenen Menü, das nie auf dem Server entsteht; daher keine Abweichung beim Hydrieren. */
function usePhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(PHONE).matches : false),
    () => false,
  );
}

function headerMenuItem(action: HeaderAction) {
  return (
    <DropdownMenuItem
      key={action.key}
      onSelect={action.onSelect}
      disabled={action.disabled}
      data-testid={action.testId ? `${action.testId}-item` : undefined}
      render={action.href && !action.disabled ? <Link href={action.href} /> : undefined}
    >
      {action.label}
    </DropdownMenuItem>
  );
}

/**
 * Die Nebenaktionen des Seitenkopfs: Knöpfe ab `sm` (`data-header-more-button`, am Telefon ausgeblendet), danach die
 * übrigen Aktionen (`children`), am Ende das ⋯ fürs Telefon (`data-header-more`). Hat die Seite ein `RecordActions`,
 * blendet `globals.css` dieses ⋯ aus, und `RecordActions` nimmt die Einträge in sein Menü. Baustein von `PageHeader`.
 */
export function HeaderMore({ items, children }: { items: readonly HeaderAction[]; children?: ReactNode }) {
  const t = useTranslations('common');
  const visible = items.filter((item) => !item.hidden);
  return (
    <HeaderMoreContext value={visible}>
      {visible.map((item) =>
        item.href && !item.disabled ? (
          <Link key={item.key} href={item.href} className={`${buttonVariants({ variant: 'outline' })} max-sm:hidden`} data-header-more-button data-testid={item.testId}>
            {item.icon}
            {item.label}
          </Link>
        ) : (
          <Button key={item.key} type="button" variant="outline" className="max-sm:hidden" disabled={item.disabled} onClick={item.onSelect} data-header-more-button data-testid={item.testId}>
            {item.icon}
            {item.label}
          </Button>
        ),
      )}
      {children}
      {visible.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('moreActions')}
                data-record-actions
                data-header-more
                // Nur am Telefon; Klickfläche 44 px wie `RecordActions`.
                className="relative after:absolute after:-inset-[3px] sm:hidden"
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            {visible.map(headerMenuItem)}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </HeaderMoreContext>
  );
}

import type { BlockReason } from '@/lib/folder-tree-model';
import type { Translate } from './folder-tree-row';

/**
 * Die Sätze der Live-Region beim Ziehen (README § 5, Tabelle), deutsch und
 * ohne Tastencodes. Ablegen selbst sagt nichts: Das übernimmt der Toast.
 */

/** Der Sperrgrund in Worten, wie er auch in der Zeile steht. */
export function blockText(t: Translate, reason: BlockReason, name: string): string {
  return t(`block.${reason}`, { name });
}

export function announcePickUp(t: Translate, name: string): string {
  return t('announce.pickUp', { name });
}

/** Ein Grund steht in der Zeile als eigener Satz; im Satzgefüge der Ansage ohne Schlusspunkt. */
export const clause = (reason: string) => reason.replace(/\.$/, '');

/** Ein neues Ziel unter Zeiger oder Fokus. */
export function announceTarget(t: Translate, target: string, opening: boolean, blocked: string | null): string {
  if (blocked) return t('announce.blocked', { name: target, reason: clause(blocked) });
  return t(opening ? 'announce.targetOpening' : 'announce.target', { name: target });
}

export function announceOpened(t: Translate, name: string, children: number): string {
  return t('announce.opened', { name, count: children });
}

export function announceNotDropped(t: Translate, name: string, reason: string): string {
  return t('announce.notDropped', { name, reason: clause(reason) });
}

/** `parent` ist `null` auf der obersten Ebene. */
export function announceCancelled(t: Translate, name: string, parent: string | null): string {
  return parent === null ? t('announce.cancelledTop', { name }) : t('announce.cancelled', { name, parent });
}

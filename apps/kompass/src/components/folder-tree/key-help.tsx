'use client';

import { useTranslations } from 'next-intl';
import { KeyChip } from '@/components/key-chip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Key = { text: string; label?: string };
type Group = { title: string; items: { keys: Key[]; text: string }[] };

/** Apple-Geräte zeigen Strg und Umschalt als ⌃ und ⇧ (Spec § 9: die Taste bleibt Strg, nicht ⌘). */
function isApple(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/**
 * Tastaturhilfe des Ordnerbaums (HANDOFF § 3.7, Board K8). Ein Dialog, kein
 * Tooltip: Er braucht Platz und schließt mit Esc; der Fokus kehrt auf die
 * Zeile zurück, von der er kam. Die Blöcke „Pflegen“ (F2, Menü) und
 * „Verschieben“ (Ordner aufnehmen) nur mit Pflegerecht.
 */
export function FolderTreeKeyHelp({
  open,
  onOpenChange,
  canManage,
  apple,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  /** Für Tests; sonst aus dem Gerät gelesen, erst beim Öffnen (im Browser). */
  apple?: boolean;
}) {
  const t = useTranslations('folderTree');
  const k = (key: string) => t(`keyNames.${key}`);
  const up: Key = { text: '↑', label: k('up') };
  const down: Key = { text: '↓', label: k('down') };
  const mac = open && (apple ?? isApple());

  const groups: Group[] = [
    {
      title: t('keys.groupMove'),
      items: [
        { keys: [up, down], text: t('keys.upDown') },
        { keys: [{ text: '→', label: k('right') }], text: t('keys.right') },
        { keys: [{ text: '←', label: k('left') }], text: t('keys.left') },
        { keys: [{ text: k('home') }, { text: k('end') }], text: t('keys.homeEnd') },
        { keys: [{ text: k('letters') }], text: t('keys.letters') },
        { keys: [{ text: k('enter') }], text: t('keys.enter') },
      ],
    },
  ];
  if (canManage) {
    groups.push({
      title: t('keys.groupManage'),
      items: [
        { keys: [{ text: k('f2') }], text: t('keys.rename') },
        { keys: mac ? [{ text: k('shiftMac'), label: k('shift') }, { text: k('f10') }] : [{ text: k('shift') }, { text: k('f10') }], text: t('keys.menu') },
      ],
    });
    groups.push({
      title: t('keys.groupDrag'),
      items: [
        {
          keys: mac
            ? [{ text: k('ctrlMac'), label: k('ctrl') }, { text: k('shiftMac'), label: k('shift') }, { text: 'D' }]
            : [{ text: k('ctrl') }, { text: k('shift') }, { text: 'D' }],
          text: t('keys.pickUp'),
        },
        { keys: [up, down], text: t('keys.target') },
        { keys: [{ text: k('enter') }], text: t('keys.drop') },
        { keys: [{ text: k('esc') }], text: t('keys.cancel') },
      ],
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" className="gap-3 bg-surface text-ink">
        <DialogHeader>
          <DialogTitle>{t('keyHelpTitle')}</DialogTitle>
        </DialogHeader>
        {groups.map((group) => (
          <section key={group.title} className="flex flex-col gap-1.5">
            <h3 className="font-body text-[11px] leading-normal font-bold tracking-[0.06em] text-muted-ink uppercase">{group.title}</h3>
            {group.items.map((item) => (
              <div key={item.text} className="flex items-baseline gap-3 text-[13px] leading-[1.45]">
                <span className="flex w-[148px] shrink-0 flex-wrap gap-1">
                  {item.keys.map((key) => (
                    <KeyChip key={key.text} label={key.label}>
                      {key.text}
                    </KeyChip>
                  ))}
                </span>
                <span className="text-ink-2">{item.text}</span>
              </div>
            ))}
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}

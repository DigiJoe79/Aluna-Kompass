'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button, buttonVariants } from '@/components/ui/button';
import { countChanged, snapshotOf, type Snapshot } from '@/lib/form-dirty';

/**
 * Die Speicherleiste für Formularseiten, wie im Handover beschrieben: sticky,
 * nennt die Anzahl geänderter Felder, „Verwerfen“ setzt auf den geladenen Stand
 * zurück.
 *
 * Dazu ein Ausgang. „Verwerfen“ und „Abbrechen“ sind nicht dasselbe: Das eine
 * nimmt die Eingaben zurück und lässt einen auf der Seite, das andere führt
 * weg. Wer ein Tier anlegt und es sich anders überlegt, will das zweite.
 *
 * Gehört **in** das `<form>`; den Stand liest sie von dort, nicht aus Props.
 */
export function FormActionBar({
  back,
  saveLabel,
  count,
  onDiscard,
}: {
  /**
   * Fehlt, wenn die Seite selbst in der Navigation hängt: Dort ist man schon
   * oben, und „Abbrechen“ führte nirgendwohin. „Verwerfen“ bleibt.
   */
  back?: { href: string; label: string };
  saveLabel?: string;
  /**
   * Für Formulare, die ihren Inhalt als ein einziges verstecktes Feld
   * abschicken: Aus dem Formular gezählt wäre es immer genau eines, egal wie
   * viel geändert wurde. Sie kennen ihren Stand selbst und geben ihn mit.
   */
  count?: number;
  /**
   * Formulare mit eigenem Zustand geben ihr Zurücksetzen selbst mit. Ohne das
   * wird die Seite neu geladen — `form.reset()` allein trägt nicht weit genug:
   * Felder wie `LocalizedField` halten ihren Text in React, und der überlebt
   * ein Zurücksetzen des Formulars.
   */
  onDiscard?: () => void;
}) {
  const t = useTranslations('common');
  const anchor = useRef<HTMLDivElement>(null);
  const initial = useRef<Snapshot | null>(null);
  const [fromDom, setFromDom] = useState(0);
  const changed = count ?? fromDom;

  useEffect(() => {
    if (count !== undefined) return;
    const form = anchor.current?.closest('form');
    if (!form) return;

    const read = () => snapshotOf(new FormData(form));
    initial.current = read();
    const recount = () => setFromDom(countChanged(initial.current ?? new Map(), read()));

    // `input` deckt das Tippen ab, `change` die Auswahlfelder und Haken.
    form.addEventListener('input', recount);
    form.addEventListener('change', recount);
    form.addEventListener('reset', () => queueMicrotask(recount));
    return () => {
      form.removeEventListener('input', recount);
      form.removeEventListener('change', recount);
    };
  }, [count]);

  return (
    <div
      ref={anchor}
      className="sticky bottom-0 flex items-center gap-3 border-t border-line bg-surface-2 px-6 py-3"
    >
      <span className={changed > 0 ? 'text-[13px] font-semibold text-warning' : 'text-[13px] text-ink-2'}>
        {changed > 0 ? t('changesPending', { count: changed }) : ''}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {back ? (
          <Link href={back.href} className={buttonVariants({ variant: 'ghost' })}>
            {t('cancel')}
          </Link>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          // Ohne Änderungen wäre der Knopf ein Versprechen, das ins Leere greift.
          disabled={changed === 0}
          onClick={() => (onDiscard ? onDiscard() : window.location.reload())}
        >
          {t('discard')}
        </Button>
        <SubmitButton>{saveLabel ?? t('save')}</SubmitButton>
      </div>
    </div>
  );
}

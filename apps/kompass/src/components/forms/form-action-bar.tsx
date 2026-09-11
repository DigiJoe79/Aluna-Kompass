'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button, buttonVariants } from '@/components/ui/button';
import { countChanged, snapshotOf, type Snapshot } from '@/lib/form-dirty';
import { cn } from '@/lib/utils';

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
  cancel,
  sticky = true,
  saveLabel,
  saveLabelChanged,
  saveDisabled,
  count,
  baseline,
  onChangedCount,
  onDiscard,
}: {
  /**
   * Fehlt, wenn die Seite selbst in der Navigation hängt: Dort ist man schon
   * oben, und „Abbrechen“ führte nirgendwohin. „Verwerfen“ bleibt.
   */
  back?: { href: string; label: string };
  /**
   * In einem Dialog führt „Abbrechen“ nicht weg, sondern schliesst. Ein Link
   * dorthin, wo man ohnehin schon steht, wäre eine Lüge.
   */
  cancel?: () => void;
  /**
   * In einem Dialog klebt nichts: Der Dialog steht fest und ist selbst
   * verschoben — eine klebende Leiste darin rechnet gegen das Fenster und
   * landet mitten im Formular.
   */
  sticky?: boolean;
  saveLabel?: string;
  /**
   * Beschriftung, solange etwas geändert ist. Der Knopf sagt dann, was er
   * wirklich tut — „Speichern und Vorschau aktualisieren“ statt „Speichern“.
   */
  saveLabelChanged?: string;
  /**
   * Für Formulare, denen noch etwas fehlt, ohne das ein Absenden nichts
   * bewirken kann — die Akte ohne Datei etwa.
   */
  saveDisabled?: boolean;
  /**
   * Für Formulare, die ihren Inhalt als ein einziges verstecktes Feld
   * abschicken: Aus dem Formular gezählt wäre es immer genau eines, egal wie
   * viel geändert wurde. Sie kennen ihren Stand selbst und geben ihn mit.
   */
  count?: number;
  /**
   * Zählt neu ab hier. Formulare, die auf ihrem Bildschirm bleiben, erhöhen den
   * Wert nach jedem erfolgreichen Speichern — sonst stünde dort für immer
   * „geändert“, obwohl längst alles gespeichert ist.
   */
  baseline?: number;
  /**
   * Für Bildschirme, die vom Zustand des Formulars abhängen — die Briefvorschau
   * etwa, die veraltet, sobald jemand tippt.
   */
  onChangedCount?: (count: number) => void;
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
  const [hasRequired, setHasRequired] = useState(false);
  // Als Ref, damit ein neuer Rückruf die Horcher nicht jedes Mal neu hängt.
  const onChanged = useRef(onChangedCount);
  onChanged.current = onChangedCount;
  const changed = count ?? fromDom;

  // Die Legende erklärt das Sternchen an den Feldern — nur dort, wo eines steht.
  useEffect(() => {
    setHasRequired(!!anchor.current?.closest('form')?.querySelector('[required]'));
  }, []);

  useEffect(() => {
    if (count !== undefined) return;
    const form = anchor.current?.closest('form');
    if (!form) return;

    const read = () => snapshotOf(new FormData(form));
    initial.current = read();
    const recount = () => {
      const next = countChanged(initial.current ?? new Map(), read());
      setFromDom(next);
      // Erst nach dem Ereignis melden: Dieser Horcher hängt am Formular und
      // läuft vor Reacts eigenem.
      queueMicrotask(() => onChanged.current?.(next));
    };

    // Der neue Stand ist der Stand: Nach einem Speichern, das auf dem
    // Bildschirm bleibt, zählt die Leiste bei null weiter — und sagt es auch
    // denen, die davon abhängen.
    recount();

    // `input` deckt das Tippen ab, `change` die Auswahlfelder und Haken.
    form.addEventListener('input', recount);
    form.addEventListener('change', recount);
    form.addEventListener('reset', () => queueMicrotask(recount));
    return () => {
      form.removeEventListener('input', recount);
      form.removeEventListener('change', recount);
    };
  }, [count, baseline]);

  return (
    <div
      ref={anchor}
      className={cn(
        'flex items-center gap-3 border-t border-line bg-surface-2 px-6 py-3',
        sticky && 'sticky bottom-0'
      )}
    >
      <span className={changed > 0 ? 'text-[13px] font-semibold text-warning' : 'text-[12px] text-muted-ink'}>
        {changed > 0 ? t('changesPending', { count: changed }) : hasRequired ? t('requiredLegend') : ''}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {cancel ? (
          <Button type="button" variant="ghost" onClick={cancel}>
            {t('cancel')}
          </Button>
        ) : back ? (
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
        <SubmitButton disabled={saveDisabled}>
          {(changed > 0 ? saveLabelChanged : undefined) ?? saveLabel ?? t('save')}
        </SubmitButton>
      </div>
    </div>
  );
}

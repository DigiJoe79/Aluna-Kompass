'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BeforeAfter } from '@/components/before-after';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { Notice } from '@/components/notice';
import { SaveStatus, type SaveState } from '@/components/forms/save-status';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button, buttonVariants } from '@/components/ui/button';
import { isRefusal, type ActionState } from '@/lib/actions';
import { conflictRemedies, stashInputs, takeStash, type StashedInput } from '@/lib/conflict-remedies';
import { countChanged, rebaseSnapshot, snapshotOf, type Snapshot } from '@/lib/form-dirty';
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
  state,
  status,
  placement: placementProp,
  mode = 'edit',
  onSave,
  pending,
  destructive,
  testId,
  saveTestId,
  saveLabel,
  saveLabelChanged,
  saveDisabled,
  saveName,
  saveValue,
  count,
  baseline,
  loadedVersion,
  onChangedCount,
  onDiscard,
  note,
  extraActions,
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
  /** Die Ablehnung des Dienstes steht über der Leiste und bleibt mit ihr sichtbar. Feldfehler zeigt `FormErrorSummary`. */
  state?: ActionState;
  /** Zwischenstand laufend gesicherter Masken („Zwischenstand gespeichert · 21:14“) in der linken Zeile. */
  status?: { state: SaveState; pending: boolean };
  /**
   * `page`: klebt am unteren Rand. `dialog`: klebt nichts — der Dialog steht
   * fest und ist selbst verschoben, eine klebende Leiste darin rechnet gegen
   * das Fenster und landet mitten im Formular. Ohne Angabe `dialog`, sobald
   * `cancel` gesetzt ist.
   */
  placement?: 'page' | 'dialog';
  /**
   * `edit` (Standard): ohne Änderung schickt Speichern nicht ab, sondern sagt
   * „Nichts geändert“. `create`: schickt immer ab, der Dienst nennt die
   * Pflichtfelder. `run`: eine Aktion ausführen (Sammelbestätigung), ohne
   * Zähler und ohne „Nichts geändert“.
   */
  mode?: 'edit' | 'create' | 'run';
  /** Für Leisten ohne `<form>` (Dialog mit eigenem Zustand): statt Absenden. Gezählt wird dann nur über `count`. */
  onSave?: () => void;
  /** Nur mit `onSave`: sperrt den Hauptknopf, solange der Aufruf läuft. */
  pending?: boolean;
  /** Hauptknopf als `destructive` (Löschen, Stornieren). */
  destructive?: boolean;
  /** Kennungen für Tests: an der Leiste und am Hauptknopf. */
  testId?: string;
  saveTestId?: string;
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
   * Name und Wert des primären Knopfs, für Formulare mit mehreren Speicherwegen:
   * Die Action liest daran, welcher Knopf abgeschickt hat (`extraActions`
   * tragen denselben Namen mit anderem Wert).
   */
  saveName?: string;
  saveValue?: string;
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
   * Ladestand des Datensatzes (etwa `updatedAt`), für Masken, die stehen bleiben, während sich der Datensatz
   * unter ihnen ändert – „Status ändern“ am Tier. Felder, die ihn per `key` neu aufbauen, zeigen den neuen
   * Wert; unberührte zieht die Leiste nach (`rebaseSnapshot`), angefasste zählen weiter. Ohne diese Prop
   * unverändert.
   */
  loadedVersion?: string;
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
  /**
   * Links vor der Zähl-Zeile, für einen Satz statt eines Zwischenstands —
   * „Bargeld wird am selben Tag festgehalten.“ bei einer Kasse. Ohne diese
   * Prop unverändertes Markup.
   */
  note?: ReactNode;
  /**
   * Zusätzliche Speicherwege vor dem primären Knopf. Es bleibt bei genau
   * einer primären Aktion — diese Knöpfe sind sekundär.
   */
  extraActions?: ReactNode;
}) {
  const t = useTranslations('common');
  const anchor = useRef<HTMLDivElement>(null);
  const initial = useRef<Snapshot | null>(null);
  // Der zuletzt gelesene Stand und wie man liest und zählt – für den neuen Ladestand unten.
  const last = useRef<Snapshot | null>(null);
  const reader = useRef<{ read: () => Snapshot; recount: () => void } | null>(null);
  const seenVersion = useRef(loadedVersion);
  const [fromDom, setFromDom] = useState(0);
  const [hasRequired, setHasRequired] = useState(false);
  // Als Ref, damit ein neuer Rückruf die Horcher nicht jedes Mal neu hängt.
  const onChanged = useRef(onChangedCount);
  onChanged.current = onChangedCount;
  const changed = count ?? fromDom;
  const placement = placementProp ?? (cancel ? 'dialog' : 'page');
  const [nothing, setNothing] = useState(false);
  // Eigene Eingaben aus einem Versionskonflikt (Neuladen mit „neben den neuen Stand legen“), gegen den jetzt gespeicherten Stand.
  const [compare, setCompare] = useState<{ label: string; yours: string; current: string }[] | null>(null);
  const blocks = mode === 'edit' && placement === 'page' && changed === 0;

  // „Nichts geändert“ verschwindet nach drei Sekunden von selbst.
  useEffect(() => {
    if (!nothing) return;
    const timer = setTimeout(() => setNothing(false), 3000);
    return () => clearTimeout(timer);
  }, [nothing]);

  // Nach dem Neuladen im Konflikt: abgelegte Eingaben neben die Felder legen. Nichts wird übernommen.
  useEffect(() => {
    const stash = takeStash(window.location.pathname);
    const form = anchor.current?.closest('form');
    if (!stash || !form) return;
    const clip = (text: string) => (text.length > 200 ? `${text.slice(0, 200)} …` : text);
    setCompare(
      stash.map((entry) => {
        const field = form.elements.namedItem(entry.name);
        const current = field && 'value' in field ? String((field as unknown as HTMLInputElement).value) : '';
        return { label: entry.label, yours: clip(entry.value), current: clip(current) };
      }),
    );
  }, []);

  // Die Legende erklärt das Sternchen an den Feldern — nur dort, wo eines steht.
  useEffect(() => {
    setHasRequired(!!anchor.current?.closest('form')?.querySelector('[required]'));
  }, []);

  useEffect(() => {
    if (count !== undefined) return;
    const form = anchor.current?.closest('form');
    if (!form) return;

    // `form.elements` kennt auch Felder mit Attribut `form`, die außerhalb stehen.
    const ignored = () => new Set(Array.from(form.elements).filter((el) => el instanceof HTMLElement && el.dataset.dirtyIgnore !== undefined).map((el) => (el as HTMLInputElement).name));
    const read = () => snapshotOf(new FormData(form), ignored());
    initial.current = read();
    const recount = () => {
      last.current = read();
      const next = countChanged(initial.current ?? new Map(), last.current);
      setFromDom(next);
      // Erst nach dem Ereignis melden: Dieser Horcher hängt am Formular und
      // läuft vor Reacts eigenem.
      queueMicrotask(() => onChanged.current?.(next));
    };

    reader.current = { read, recount };

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

  // Ein neuer Ladestand setzt nicht alles neu wie `baseline`, er zieht nur nach. Läuft nach dem Effekt oben:
  // Wechseln beide zugleich (Speichern), ist der Stand dort schon frisch gelesen und hier nichts mehr zu tun.
  useEffect(() => {
    if (loadedVersion === seenVersion.current) return;
    seenVersion.current = loadedVersion;
    if (!reader.current || !initial.current || !last.current) return;
    initial.current = rebaseSnapshot(initial.current, last.current, reader.current.read());
    reader.current.recount();
  }, [loadedVersion]);

  // Versionskonflikt: Auswege an die Ablehnung hängen. Im Dialog gibt es nur das Neuladen.
  const stale = state?.status === 'error' && state.code === 'staleVersion' && !state.remedies;
  const shownState =
    state && stale && state.status === 'error'
      ? {
          ...state,
          remedies: conflictRemedies(
            {
              compare: () => {
                const form = anchor.current?.closest('form');
                if (form && initial.current && reader.current) {
                  const now = reader.current.read();
                  const entries: StashedInput[] = [];
                  for (const [name, value] of now) {
                    if (initial.current.get(name) === value) continue;
                    const field = form.elements.namedItem(name);
                    if (field instanceof HTMLInputElement && field.type === 'hidden') continue;
                    const id = field && 'id' in field ? (field as HTMLElement).id : '';
                    const label = id ? form.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.replace(/\s*\*\s*$/, '').trim() : undefined;
                    entries.push({ name, label: label || name, value });
                  }
                  stashInputs(window.location.pathname, entries);
                }
                window.location.reload();
              },
              reload: () => window.location.reload(),
            },
            t,
          ).filter((_, index) => placement === 'page' || index === 1),
        }
      : state;

  const line =
    nothing ? (
      <span aria-live="polite" className="text-[13px] text-ink-2">
        {t('nothingChanged')}
      </span>
    ) : mode !== 'run' && changed > 0 ? (
      <span aria-live="polite" className="text-[13px] font-semibold text-warning">
        {t('changesPending', { count: changed })}
      </span>
    ) : note ? (
      <div className="text-[13px] text-ink-2">{note}</div>
    ) : status ? (
      <SaveStatus state={status.state} pending={status.pending} />
    ) : hasRequired ? (
      <span className="text-[12px] text-muted-ink">{t('requiredLegend')}</span>
    ) : null;

  return (
    // `px-5` wie das Polster von Formularkarte und Dialog (20 px, docs/MUSTER.md § I): Zähler und „Speichern“
    // stehen bündig mit den Feldern darüber.
    <div
      ref={anchor}
      data-slot="form-action-bar"
      data-testid={testId}
      className={cn('border-t border-line bg-surface-2 px-5 py-3', placement === 'page' ? 'sticky bottom-0 rounded-b-lg' : 'mx-[calc(var(--dialog-pad,0px)*-1)] mb-[calc(var(--dialog-pad,0px)*-1)] rounded-b-xl')}
    >
      {compare ? (
        <div className="mb-3">
          <Notice level="hint" title={t('conflict.compareTitle')}>
            <BeforeAfter layout="cards" columnLabels={{ before: t('conflict.yours'), after: t('conflict.current') }} rows={compare.map((row) => ({ label: row.label, before: row.yours, after: row.current }))} />
            <div className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setCompare(null)}>
                {t('conflict.dismiss')}
              </Button>
            </div>
          </Notice>
        </div>
      ) : null}
      {shownState && isRefusal(shownState) ? (
        <div className="mb-3">
          <RefusalNotice state={shownState} />
        </div>
      ) : null}
      <div className="flex items-center gap-3 max-sm:flex-col max-sm:items-stretch">
        {line}
        <div className="ml-auto flex items-center gap-2 max-sm:ml-0 max-sm:flex-col-reverse max-sm:[&>*]:w-full">
          {extraActions}
          {cancel ? (
            <Button type="button" variant="ghost" onClick={cancel}>
              {t('cancel')}
            </Button>
          ) : back ? (
            <Link href={back.href} className={buttonVariants({ variant: 'ghost' })}>
              {t('cancel')}
            </Link>
          ) : null}
          {/*
            Im Dialog gibt es kein „Verwerfen“: Dort wirft „Abbrechen“ ohnehin
            alles weg, und derselbe Vorgang unter zweitem Namen ist ein Weg zu
            viel. Auf Seiten sind die beiden verschiedene Dinge — das eine nimmt
            die Eingaben zurück, das andere führt weg.
          */}
          {cancel || mode === 'run' || (onSave && !onDiscard && count === undefined) ? null : (
            <Button
              type="button"
              variant="ghost"
              // Ohne Änderungen wäre der Knopf ein Versprechen, das ins Leere greift.
              disabled={changed === 0}
              onClick={() => (onDiscard ? onDiscard() : window.location.reload())}
            >
              {t('discard')}
            </Button>
          )}
          {onSave ? (
            <Button
              type="button"
              variant={destructive ? 'destructive' : 'default'}
              disabled={pending || saveDisabled}
              aria-busy={pending}
              data-testid={saveTestId}
              onClick={() => {
                if (blocks) return setNothing(true);
                onSave();
              }}
            >
              {(changed > 0 ? saveLabelChanged : undefined) ?? saveLabel ?? t('save')}
            </Button>
          ) : (
            <SubmitButton
              disabled={saveDisabled}
              name={saveName}
              value={saveValue}
              variant={destructive ? 'destructive' : 'default'}
              data-testid={saveTestId}
              onClick={(event) => {
                if (!blocks) return;
                event.preventDefault();
                setNothing(true);
              }}
            >
              {(changed > 0 ? saveLabelChanged : undefined) ?? saveLabel ?? t('save')}
            </SubmitButton>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BeforeAfter } from '@/components/before-after';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { Notice } from '@/components/notice';
import { RecordActions, type RecordAction } from '@/components/record-actions';
import { SaveStatus, type SaveState } from '@/components/forms/save-status';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button, buttonVariants } from '@/components/ui/button';
import { isRefusal, type ActionState } from '@/lib/actions';
import { conflictRemedies, stashInputs, takeStash, type StashedInput } from '@/lib/conflict-remedies';
import { countChanged, rebaseSnapshot, snapshotOf, type Snapshot } from '@/lib/form-dirty';
import { leavingLink } from '@/lib/leave-guard';
import { cn } from '@/lib/utils';

type BaseProps = {
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
   * Zählt mit, zeigt die Zahl aber nicht: Der Satz in `note` bleibt links stehen, statt dem Zähler zu weichen
   * („Neue Buchung“, „Umwidmung“ — Befund 41). Verwerfen und die Rückfrage beim Verlassen richten sich weiter
   * nach dem Zähler, gefragt wird also nur mit Eingaben.
   */
  countHidden?: boolean;
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
  /**
   * Ohne „Verwerfen“ — **nur auf Prüfseiten** (Freigabe Designer 2026-10-10): Die Maske ist vorbefüllt, entschieden
   * wird mit Annehmen/Ablehnen, und „Verwerfen“ stünde als vierte Wahl neben „Ablehnen“. Wer die Vorbefüllung
   * zurückwill, bricht ab und öffnet neu. Wächter `patterns/hide-discard.test.ts` hält die Option dort.
   */
  hideDiscard?: boolean;
  /**
   * Fuß eines Assistenten (Entwurf E3, Designer 2026-10-17): links „← Zurück“ (im ersten Schritt unsichtbar, damit
   * nichts springt), daneben „Schritt n von m“ statt des Zählers — „Weiter“ speichert den Schritt —, rechts
   * „Abbrechen“ (`back`) und der Primärknopf (`onSave`, `saveLabel` nennt im letzten Schritt die Handlung). Klebt wie
   * auf einer Seite; ab Schritt 2 fragt Verlassen nach.
   */
  variant?: 'wizard';
  wizard?: { step: number; total: number; onBack: () => void };
  /**
   * `plain` (Designer Runde 6, vorläufig, Joe 2026-10-25): die Leiste am Ende eines Schritts in `Steps compact`, ohne
   * eigene Karte — ohne Rand und Fläche, nur eine Trennlinie darüber, klebt nicht. Links „Speichern“ (mit „Verwerfen“
   * und Zähler), rechts `extraActions` (Übergabeprotokoll: „Zum Unterschreiben drucken“, „Scan ablegen …“). Nur im
   * Schritt nutzen.
   */
  surface?: 'plain';
};

/**
 * Aktionen am ganzen Datensatz links im Fuß (Spec Seitenkopf § 3.3, Freigabe Designer 2026-10-08) — nur, wo der Fuß
 * nicht klebt: in Dialog und Seitenfenster, die keinen Seitenkopf haben. Auf einer Seite gehören sie in den Kopf
 * (`RecordActions`); dort ist die Prop im Typ ausgeschlossen, und der Wächter `record-action-placement` prüft es
 * zusätzlich. Ein Eintrag wird ein `ghost`-Knopf, zwei oder mehr das Menü ⋯.
 */
type RecordActionProp =
  | { placement: 'dialog'; recordAction?: RecordAction | readonly RecordAction[] }
  | {
      /*
       * `page`: klebt am unteren Rand. `dialog`: klebt nichts — der Dialog steht
       * fest und ist selbst verschoben, eine klebende Leiste darin rechnet gegen
       * das Fenster und landet mitten im Formular. Ohne Angabe `dialog`, sobald
       * `cancel` gesetzt ist.
       */
      placement?: 'page';
      recordAction?: never;
    };

type FormActionBarProps = BaseProps & RecordActionProp;

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
  countHidden,
  baseline,
  loadedVersion,
  onChangedCount,
  onDiscard,
  note,
  extraActions,
  hideDiscard = false,
  variant,
  wizard: wizardProp,
  surface,
  recordAction,
}: FormActionBarProps) {
  const plain = surface === 'plain';
  const wizard = variant === 'wizard' ? wizardProp : undefined;
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
  const recordActions: readonly RecordAction[] = recordAction ? (Array.isArray(recordAction) ? recordAction : [recordAction as RecordAction]) : [];
  const [nothing, setNothing] = useState(false);
  // Eigene Eingaben aus einem Versionskonflikt (Neuladen mit „neben den neuen Stand legen“), gegen den jetzt gespeicherten Stand.
  const [compare, setCompare] = useState<{ label: string; yours: string; current: string }[] | null>(null);
  const blocks = !wizard && mode === 'edit' && placement === 'page' && changed === 0;
  // Ob die Leiste gerade klebt — nur dann trägt sie einen Schatten (Designer 2026-10-08).
  const [stuck, setStuck] = useState(false);
  // Rückfrage beim Verlassen: nur auf einer Seite, nur mit Ungespeichertem. Ausführen hat nichts zu verlieren, eine
  // laufend gesicherte Maske (`status`) hat es schon gesichert, ein Dialog führt mit „Abbrechen“ nirgendwohin.
  const guarded = wizard ? wizard.step > 1 : placement === 'page' && mode !== 'run' && !status && changed > 0;
  const [leaveTo, setLeaveTo] = useState<HTMLAnchorElement | null>(null);
  // Der eigene Weg hinaus (Verwerfen lädt neu, der Konflikt auch, „Seite verlassen“ klickt den Link) fragt nicht.
  const leaving = useRef(false);

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

  // Klebt sie? Die Marke am Ende der `FormCard` sagt es: Liegt sie unter dem Fenster, steht die Leiste am unteren
  // Rand statt an ihrem Platz. Ob sie überhaupt klebt (ab 640 × 600 px), entscheidet die Variante `stickybar` im CSS.
  useEffect(() => {
    if (placement !== 'page' || plain || typeof IntersectionObserver === 'undefined') return;
    const card = anchor.current?.closest('[data-slot="form-card"]');
    const end = card ? Array.from(card.children).find((el) => el instanceof HTMLElement && el.dataset.slot === 'form-card-end') : undefined;
    if (!end) return;
    // Klebend sitzt die Leiste um das Polster von `main` tiefer (negatives `bottom`, Designer 2026-10-22). Endet die
    // Karte in diesem Streifen, steht die Leiste schon fast am Rand: Sie gilt dann als klebend, damit ein Toast über
    // sie rückt, statt „Speichern“ zu verdecken (E2E site-entries, 2026-10-22).
    const offset = anchor.current ? -parseFloat(getComputedStyle(anchor.current).bottom) : 0;
    const pad = Number.isFinite(offset) && offset > 0 ? Math.round(offset) : 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        const bottom = entry.rootBounds?.bottom ?? window.innerHeight - pad;
        setStuck(!entry.isIntersecting && entry.boundingClientRect.top >= bottom);
      },
      { rootMargin: `0px 0px -${pad}px 0px` },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [placement, plain]);

  useEffect(() => {
    if (!guarded) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      event.preventDefault();
      // Ältere Browser fragen nur mit gesetztem `returnValue`.
      event.returnValue = '';
    };
    // In der Einfangphase am Dokument: vor dem Router (`next/link` horcht an der React-Wurzel).
    const onClick = (event: MouseEvent) => {
      if (leaving.current) return;
      // `data-form-scope`: ein Bereich um die Karte, dessen Links auf dieselbe Seite die Eingaben behalten (Reiter der
      // Stammdaten über der Karte, Runde 3, 149).
      const scope = anchor.current?.closest('[data-form-scope]') ?? anchor.current?.closest('[data-slot="form-card"]') ?? anchor.current?.closest('form');
      const link = leavingLink(event, window.location, scope);
      if (!link) return;
      event.preventDefault();
      // Auch andere Leisten derselben Seite fragen nicht ein zweites Mal.
      event.stopImmediatePropagation();
      setLeaveTo(link);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [guarded]);

  const reload = () => {
    leaving.current = true;
    window.location.reload();
  };

  // Stern ⇔ Fußhinweis (Designer Runde 3: 034, 040, 094, 186, 188): Die Legende erklärt das Sternchen an den Feldern —
  // genau dann, wenn eines im Formular bzw. Dialog steht. Felder erscheinen bedingt, darum horcht ein Beobachter mit.
  useEffect(() => {
    const scope = anchor.current?.closest('form, [data-slot="dialog-content"], [data-slot="sheet-content"]');
    if (!scope) return;
    const check = () => setHasRequired(!!scope.querySelector('[data-slot="label-required"]'));
    check();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(check);
    observer.observe(scope, { childList: true, subtree: true });
    return () => observer.disconnect();
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
                reload();
              },
              reload,
            },
            t,
          ).filter((_, index) => placement === 'page' || index === 1),
        }
      : state;

  // Der Zähler nur beim Bearbeiten: Beim Anlegen ist jede Eingabe neu, dort steht die Pflichtfeld-Legende (Designer
  // Stufe 2 Nr. 7). Die Rückfrage beim Verlassen (`guarded`) zählt trotzdem mit. Ein bestehender Datensatz
  // (`loadedVersion`), der nur `create` nutzt, damit er auch ohne Änderung abschickt (Prüfung der Tiere, Entwurf einer
  // Buchung), zählt weiter.
  const counts = mode === 'edit' || (mode === 'create' && loadedVersion !== undefined);
  // „Verwerfen“ nur mit Änderungen an einem bestehenden Datensatz, nie beim Anlegen — dort gibt es nur „Abbrechen“
  // (Designer 2026-10-16, Teil 2 Nr. 1). Ohne Änderung wäre der Knopf ein Versprechen, das ins Leere greift. Seit Runde 3
  // (087, 091) ohne Ausnahme, auch in der Buchungsmaske.
  const canDiscard = !(hideDiscard || cancel || mode === 'run' || (onSave && !onDiscard && count === undefined));
  const showDiscard = !wizard && canDiscard && counts && changed > 0;
  // Nur einer der beiden Nebenknöpfe: Am Telefon nimmt er die ganze Zeile.
  const lone = Number(showDiscard) + Number(!!(cancel || back)) === 1;
  // Runde 3, 083/085: „Schritt n von m“ sagt der Schrittbalken (`Steps`) über dem Assistenten — auf jeder Breite; der
  // Fuß wiederholt es nicht und zeigt auch keinen Zähler. Ein Satz in `note` steht auch hier (CSV-Assistent Schritt 3:
  // „Noch offen: …“, Spec 2026-10-22); `aria-live`, weil er sich mit jeder Auswahl ändert.
  const main = wizard ? (note ? <div aria-live="polite" className="text-meta text-ink-2">{note}</div> : null) :
    nothing ? (
      <span aria-live="polite" className="text-meta text-ink-2">
        {t('nothingChanged')}
      </span>
    ) : counts && changed > 0 && !countHidden ? (
      <span aria-live="polite" className="text-meta font-semibold text-warning">
        {t('changesPending', { count: changed })}
      </span>
    ) : note ? (
      <div className="text-meta text-ink-2">{note}</div>
    ) : status ? (
      <SaveStatus state={status.state} pending={status.pending} />
    ) : null;
  const legend = !wizard && hasRequired ? <span className="text-hint text-muted-ink">{t('requiredLegend')}</span> : null;
  const line = main && legend ? (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {main}
      {legend}
    </div>
  ) : (
    main ?? legend
  );

  const discardButton = !showDiscard ? null : (
    <Button
      type="button"
      variant="ghost"
      className={cn(!plain && 'max-sm:order-3', !plain && lone && 'max-sm:col-span-2')}
      onClick={() => (onDiscard ? onDiscard() : reload())}
    >
      {t('discard')}
    </Button>
  );
  const saveClass = plain ? undefined : 'max-sm:order-1 max-sm:col-span-2';
  // Im Schritt (Designer Runde 6, 15a): ohne Änderung `outline` und gesperrt — dann trägt eine Handlung des Schritts
  // (`extraActions`) die Hauptsache, und es gibt nie zwei primäre Knöpfe.
  const plainIdle = plain && changed === 0;
  const saveButton = onSave ? (
    <Button
      type="button"
      variant={destructive ? 'destructive' : plainIdle ? 'outline' : 'default'}
      className={saveClass}
      disabled={pending || saveDisabled || plainIdle}
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
      className={saveClass}
      data-testid={saveTestId}
      onClick={(event) => {
        if (!blocks) return;
        event.preventDefault();
        setNothing(true);
      }}
    >
      {(changed > 0 ? saveLabelChanged : undefined) ?? saveLabel ?? t('save')}
    </SubmitButton>
  );

  return (
    // `px-5` wie das Polster von Formularkarte und Dialog (20 px, docs/MUSTER.md § I): Zähler und „Speichern“
    // stehen bündig mit den Feldern darüber. Auf einer Seite klebt sie erst ab 640 × 600 px (`stickybar`, MUSTER
    // § B); im Telefon oder einem niedrigen Fenster nähme sie sonst ein Drittel der Höhe. Klebend sitzt sie bündig am
    // Rand von `main` (das Polster `--shell-pad` zählt beim Kleben mit, sonst scrollte darunter ein Streifen Inhalt),
    // eckig, und ein Verlauf darüber blendet die Zeile aus, statt sie abzuschneiden (Designer 2026-10-22, Backlog 77).
    <div
      ref={anchor}
      data-slot="form-action-bar"
      data-placement={placement}
      data-testid={testId}
      data-stuck={placement === 'page' && stuck ? '' : undefined}
      data-surface={surface}
      className={cn(
        plain ? 'border-t border-line-2 pt-3' : 'border-t border-line bg-surface-2 px-5 py-3',
        plain ? undefined : placement === 'page' ? "rounded-b-lg stickybar:sticky stickybar:bottom-[calc(var(--shell-pad,0px)*-1)] stickybar:data-[stuck]:rounded-b-none stickybar:data-[stuck]:before:pointer-events-none stickybar:data-[stuck]:before:absolute stickybar:data-[stuck]:before:inset-x-0 stickybar:data-[stuck]:before:bottom-full stickybar:data-[stuck]:before:h-6 stickybar:data-[stuck]:before:bg-linear-to-b stickybar:data-[stuck]:before:from-transparent stickybar:data-[stuck]:before:to-surface stickybar:data-[stuck]:before:content-['']" : 'mx-[calc(var(--dialog-pad,0px)*-1)] mb-[calc(var(--dialog-pad,0px)*-1)] rounded-b-xl',
      )}
    >
      {compare ? (
        <div className="mb-3">
          <Notice level="hint" title={t('conflict.compareTitle')}>
            <BeforeAfter layout="cards" columnLabels={{ before: t('conflict.yours'), after: t('conflict.current') }} rows={compare.map((row) => ({ label: row.label, before: row.yours, after: row.current }))} />
            <div className="pt-2">
              <Button type="button" variant="outline" onClick={() => setCompare(null)}>
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
      {plain ? (
        // Runde 6: links „Speichern“, „Verwerfen“ und Zähler, rechts die Handlungen des Schritts; bricht als Ganzes um.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {saveButton}
          {discardButton}
          {line}
          {extraActions ? <div className="ml-auto flex flex-wrap items-center gap-2.5">{extraActions}</div> : null}
        </div>
      ) : (
        <div className="flex items-center gap-3 max-sm:flex-col max-sm:items-stretch">
          {recordActions.length > 0 ? (
            // Telefon: die Aktion als letzte Zeile, durch Leerraum von den Knöpfen abgesetzt (Board § K, Ziel 3b).
            <div className="max-sm:order-last max-sm:mt-3">
              <RecordActions actions={recordActions} single="button" />
            </div>
          ) : null}
          {wizard ? (
            <Button
              type="button"
              variant="outline"
              className={cn('max-sm:order-last', wizard.step <= 1 && 'invisible')}
              aria-hidden={wizard.step <= 1 || undefined}
              tabIndex={wizard.step <= 1 ? -1 : undefined}
              onClick={wizard.onBack}
            >
              {t('wizardBack')}
            </Button>
          ) : null}
          {line}
          {/*
            Telefon (Designer 2026-10-08): „Speichern“ über die volle Breite zuerst, weitere Speicherwege darunter,
            dann „Verwerfen“ und „Abbrechen“ nebeneinander — steht nur einer da, nimmt er die Zeile.
          */}
          <div className="ml-auto flex items-center gap-2 max-sm:ml-0 max-sm:grid max-sm:grid-cols-2 max-sm:[&>*]:w-full">
            {extraActions ? <div className="contents max-sm:[&>*]:order-2 max-sm:[&>*]:col-span-2 max-sm:[&>*]:w-full">{extraActions}</div> : null}
            {cancel ? (
              <Button type="button" variant="ghost" className={cn('max-sm:order-4', lone && 'max-sm:col-span-2')} onClick={cancel}>
                {t('cancel')}
              </Button>
            ) : back ? (
              <Link href={back.href} className={cn(buttonVariants({ variant: 'ghost' }), 'max-sm:order-4', lone && 'max-sm:col-span-2')}>
                {t('cancel')}
              </Link>
            ) : null}
            {/*
              Im Dialog gibt es kein „Verwerfen“: Dort wirft „Abbrechen“ ohnehin
              alles weg, und derselbe Vorgang unter zweitem Namen ist ein Weg zu
              viel. Auf Seiten sind die beiden verschiedene Dinge — das eine nimmt
              die Eingaben zurück, das andere führt weg.
            */}
            {discardButton}
            {saveButton}
          </div>
        </div>
      )}
      {placement === 'page' ? (
        <ConfirmDialog
          open={leaveTo !== null}
          onOpenChange={(open) => {
            if (!open) setLeaveTo(null);
          }}
          title={t('leave.title')}
          description={wizard ? t('leave.wizardDescription') : t('leave.description', { count: changed })}
          confirmLabel={t('leave.confirm')}
          destructive
          action={async () => {
            // Den Link selbst noch einmal klicken: So führt der Router wie gewohnt — Vorabladen, Scrollen, Verlauf.
            leaving.current = true;
            leaveTo?.click();
            return { status: 'success' };
          }}
        />
      ) : null}
    </div>
  );
}

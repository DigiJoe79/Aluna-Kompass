'use client';

import { AlertTriangle, Minus, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Overline } from '@/components/overline';
import { Segmented } from '@/components/ui/segmented';
import {
  aspectLabel,
  cropPixelHeight,
  cropPixelWidth,
  fitToFormat,
  formatOf,
  formatRow,
  fullFormat,
  initialCrop,
  matchFormat,
  MAX_ZOOM,
  moveBy,
  pinch,
  orientationOf,
  positionOf,
  ratioValue,
  resizeAroundCenter,
  resizeFromCorner,
  roundCrop,
  setZoom,
  trimOf,
  zoomOf,
  type Corner,
  type Crop,
  type CropGeometry,
  type Orientation,
} from '@/lib/crop-geometry';
import { thresholdOf, type CropPlace } from '@/lib/crop-places';
import { useFinePointer } from '@/lib/use-fine-pointer';
import { cn } from '@/lib/utils';
import { CroppedImage } from './cropped-image';

export interface CropEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Vorschau des Originals (`mediaPreviewUrl`). */
  src: string;
  /** Original in Pixeln aus `media_assets` (nach EXIF-Drehung). */
  width: number;
  height: number;
  /**
   * Erlaubte Formate (`'W:H'` oder `'original'`): eins = fest (Zeile „fest für …“ statt der Reihe), mehrere = Auswahl
   * nur daraus, leer = volle Reihe mit Quer/Hoch (Handover alle Bilder 1–2).
   */
  formats: readonly string[];
  /** Wofür das feste Format gilt („das Titelbild“); ohne Angabe der Name der ersten Stelle. */
  fixedReason?: string;
  /** Die Stellen der Webseite: je eine Vorschaukachel (höchstens drei), Schwelle die höchste. */
  places: readonly CropPlace[];
  crop: Crop | null;
  maxZoom?: number;
  /** Blickpunkt in Prozent für den Start ohne Ausschnitt (Tiere: Einstellung „Bildausschnitt“); sonst mittig. */
  focus?: { focusX: number; focusY: number };
  /** Linke Zeile der Leiste: „Gespeichert wird mit …“ — womit, weiß der Aufrufer. */
  note: string;
  /** Gerundeter Ausschnitt oder `null` (entfernen). Ändert nur den Stand der Maske; gespeichert wird mit dem Formular. */
  onApply: (crop: Crop | null) => void;
}

const CENTER = { focusX: 50, focusY: 50 };
const MAX_PREVIEWS = 3;

const pct = (n: number) => `${n * 100}%`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const STEP_ZOOM = 0.05;
/** Ansage für Vorleser erst, wenn die Bewegung ruht — sonst sagte er jeden Pfeildruck einzeln. */
const ANNOUNCE_DELAY_MS = 600;
const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];

/**
 * Ausschnitt eines Fotos setzen, verschieben, in der Größe ändern und entfernen (Handover
 * `design_handoff_ausschnitt`, Freigabe Designer 2026-10-10). Das ganze Original, außen abgedunkelt wie
 * `CropFrame`; das Rechteck im festen Format der Webseite mit vier Eckgriffen. Ziehen im Rechteck verschiebt, eine
 * Ecke ändert die Größe um die Gegenecke, zwei Finger um ihren Mittelpunkt; ein Finger außerhalb tut nichts.
 * Tastatur am Rechteck: Pfeile, `+`/`−`, `0`, Enter; Escape bricht ab (Dialog).
 *
 * „Übernehmen“ und „Ausschnitt entfernen“ liefern über `onApply` und schließen; Abbrechen, Escape und ✕ verwerfen
 * ohne Rückfrage — der Dialog hält nur ein Rechteck.
 */
export function CropEditor(props: CropEditorProps) {
  const rect = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={props.open} onOpenChange={(next) => props.onOpenChange(next)}>
      {/*
        Telefon: volle Fläche (`lg`); die Mitte scrollt, Kopf und Leiste stehen. Ab `sm` oben verankert statt mittig und
        mit fester Rinne für die Scrollleiste: Die Warnung unter dem Schieber kommt und geht mit der Pixelbreite. Mittig
        rückte das Foto dabei um die halbe Höhe der Warnung, die Scrollleiste nahm ihm Breite — unter dem ziehenden Zeiger
        lag dann ein anderer Anteil, die Breite sprang zurück über die Schwelle, und der Dialog flackerte. Kein
        dauerhafter Test: Lage misst jsdom nicht (Feedback Layout-Tests).
      */}
      <DialogContent size="lg" layout="fixed-footer" initialFocus={rect} className="bg-surface sm:top-[7.5vh] sm:translate-y-0">
        <CropEditorBody {...props} rectRef={rect} />
      </DialogContent>
    </Dialog>
  );
}

/** Eigener Baustein im Dialog: Base UI hängt ihn beim Schließen ab, so beginnt jedes Öffnen beim übergebenen Stand. */
function CropEditorBody({ onOpenChange, src, width, height, formats, fixedReason, places, crop, maxZoom = MAX_ZOOM, focus = CENTER, note, onApply, rectRef }: CropEditorProps & { rectRef: RefObject<HTMLDivElement | null> }) {
  const t = useTranslations('media.crop');
  const format = useFormatter();
  const fine = useFinePointer();
  const geometry = (ratio: string): CropGeometry => ({ width, height, aspect: ratioValue(ratio, width, height) });
  // Start: das Format des vorhandenen Ausschnitts (`matchFormat`); passt es zu keinem erlaubten, das nächstliegende und
  // darin das größte Rechteck mittig im alten. Ohne Ausschnitt das erste Format, größtmöglich am Blickpunkt.
  // Ein Ausschnitt der Quelle oder aus MCP kann enger sein als `maxZoom`: Er startet an der Grenze, um seine Mitte —
  // sonst spränge er beim ersten Griff, und der Schieber zeigte einen Wert, den er nicht hat.
  const [start] = useState(() => {
    const match = matchFormat(crop, width, height, formats);
    const g0 = geometry(match.ratio);
    const limit = (c: Crop) => (zoomOf(c, g0) > maxZoom ? setZoom(c, g0, maxZoom, maxZoom) : c);
    if (!crop) return { ratio: match.ratio, rect: initialCrop(g0, focus), oldFormat: null };
    if (!match.exact) return { ratio: match.ratio, rect: limit(fitToFormat(crop, g0)), oldFormat: aspectLabel(formatOf(crop, g0)) };
    return { ratio: match.ratio, rect: limit(crop), oldFormat: null };
  });
  const [ratio, setRatio] = useState(start.ratio);
  // Der Satz zum Formatwechsel gilt nur, bis man selbst ein Format wählt.
  const [showOldFormat, setShowOldFormat] = useState(start.oldFormat !== null);
  const g: CropGeometry = useMemo(() => ({ width, height, aspect: ratioValue(ratio, width, height) }), [width, height, ratio]);
  const [rect, setRect] = useState<Crop>(start.rect);
  const current = useRef(rect);
  current.current = rect;
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'none' | 'move' | 'pinch' } | { kind: 'corner'; corner: Corner }>({ kind: 'none' });

  const zoom = zoomOf(rect, g);
  const zoomed = zoom > 1 + 1e-6;
  const pxW = cropPixelWidth(rect, width);
  const pxH = cropPixelHeight(rect, height);
  const minWidthPx = thresholdOf(places);
  const small = pxW < minWidthPx;
  const ratioLabel = (r: string) => (r === 'original' ? t('original') : r);
  // Formatwechsel im Dialog: das größte Rechteck im neuen Format um den Mittelpunkt des alten (Handover alle Bilder 1).
  const choose = (next: string) => {
    if (next !== 'original' && next !== '1:1') setOrientation(orientationOf(next));
    setRatio(next);
    setShowOldFormat(false);
    setRect((c) => fullFormat(c, geometry(next)));
  };
  const fixed = formats.length === 1;
  const full = formats.length === 0;
  // Quer/Hoch ist eine eigene Wahl: Original und 1:1 kennen keine Richtung, die Reihe bleibt dann, wie sie war.
  const [orientation, setOrientation] = useState<Orientation>(() => orientationOf(start.ratio));
  const rowOptions = (full ? formatRow(orientation) : [...formats]).map((r) => ({ value: r, label: ratioLabel(r) }));
  // Quer/Hoch dreht das gewählte Format; bei 1:1 und Original ohne Wirkung, dann ausgeblendet.
  const turnable = full && ratio !== 'original' && ratio !== '1:1';
  const turn = (next: Orientation) => {
    if (next !== orientation) choose(ratio.split(':').reverse().join(':'));
  };
  // Vorschau „wie gewählt“: das Rechteck in seinem eigenen Format.
  const chosenValue = ratioValue(ratio, width, height);
  const shown = places.slice(0, MAX_PREVIEWS);
  const caption = (p: CropPlace) => {
    if (p.ratio === 'original') return t('placeCaption', { place: p.label, ratio: t('lightbox') });
    const trim = trimOf(chosenValue, ratioValue(p.ratio, width, height));
    const base = t('placeCaption', { place: p.label, ratio: p.ratio });
    return trim ? `${base} · ${t(trim === 'sides' ? 'trimsSides' : 'trimsTopBottom')}` : base;
  };
  // Ein Feld mit mehreren Formaten hat mehrere Stellen gleichen Namens: der Satz dazu nur einmal.
  const tooSmallFor = places.filter((p, i) => p.minWidthPx > 0 && pxW < p.minWidthPx && places.findIndex((q) => q.label === p.label && q.minWidthPx === p.minWidthPx) === i);
  const where = positionOf(rect);
  const valueText = t('valueText', { width: String(pxW), height: String(pxH), position: t(`positions.${where.v}_${where.h}`) });
  const [announced, setAnnounced] = useState(valueText);
  useEffect(() => {
    const timer = setTimeout(() => setAnnounced(valueText), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [valueText]);

  const apply = () => {
    onApply(roundCrop(current.current));
    onOpenChange(false);
  };
  const remove = () => {
    onApply(null);
    onOpenChange(false);
  };
  const resize = (delta: number) => setRect((c) => resizeAroundCenter(c, g, delta, maxZoom));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    switch (e.key) {
      case 'ArrowLeft':
        setRect((c) => moveBy(c, g, -step, 0));
        break;
      case 'ArrowRight':
        setRect((c) => moveBy(c, g, step, 0));
        break;
      case 'ArrowUp':
        setRect((c) => moveBy(c, g, 0, -step));
        break;
      case 'ArrowDown':
        setRect((c) => moveBy(c, g, 0, step));
        break;
      case '+':
      case '=':
        resize(STEP_ZOOM);
        break;
      case '-':
      case '−':
      case '_':
        resize(-STEP_ZOOM);
        break;
      case '0':
        setRect((c) => fullFormat(c, g));
        break;
      case 'Enter':
        apply();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // Zeiger in Anteilen am Foto.
  const pointOf = (e: PointerEvent) => {
    const box = stage.current!.getBoundingClientRect();
    return { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Nur die Haupttaste der Maus; ab dem dritten Finger zählt keiner mehr mit, sonst nähme der Pinch den falschen.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pointers.current.size >= 2) return;
    const p = pointOf(e);
    pointers.current.set(e.pointerId, p);
    // Einfangen, damit das Ziehen über den Rand hinaus weiterläuft. Ein Zeiger, den der Browser nicht (mehr) kennt,
    // wirft hier — dann eben ohne Einfangen.
    try {
      stage.current?.setPointerCapture?.(e.pointerId);
    } catch {
      /* ohne Einfangen weiter */
    }
    if (pointers.current.size === 2) {
      // Zwei Finger irgendwo auf dem Foto: Größe um ihren Mittelpunkt.
      gesture.current = { kind: 'pinch' };
      setDragging(true);
      return;
    }
    const c = current.current;
    const corner = (e.target as HTMLElement).closest('[data-corner]')?.getAttribute('data-corner') as Corner | null | undefined;
    const inside = p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
    // Ein Finger außerhalb des Rechtecks tut nichts — kein versehentliches Neusetzen (Board 3).
    gesture.current = corner ? { kind: 'corner', corner } : inside ? { kind: 'move' } : { kind: 'none' };
    if (gesture.current.kind === 'none') return;
    e.preventDefault();
    rectRef.current?.focus({ preventScroll: true });
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(e.pointerId);
    if (!before) return;
    const p = pointOf(e);
    pointers.current.set(e.pointerId, p);
    const now = gesture.current;
    if (now.kind === 'pinch') {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (!other) return;
      const box = stage.current!.getBoundingClientRect();
      const dist = (a: { x: number; y: number }) => Math.hypot((a.x - other.x) * box.width, (a.y - other.y) * box.height);
      const d0 = dist(before);
      const d1 = dist(p);
      if (d0 < 1 || d1 < 1) return;
      const center = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
      setRect((c) => pinch(c, g, center, d1 / d0, maxZoom));
    } else if (now.kind === 'move') {
      setRect((c) => moveBy(c, g, p.x - before.x, p.y - before.y));
    } else if (now.kind === 'corner') {
      setRect((c) => resizeFromCorner(c, g, now.corner, p, maxZoom));
    }
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    // Nach dem Pinch bleibt ein Finger liegen: Er verschiebt nicht weiter, sonst spränge das Rechteck.
    if (gesture.current.kind === 'pinch' || pointers.current.size === 0) gesture.current = { kind: 'none' };
    if (pointers.current.size === 0) setDragging(false);
  };

  const guides = focused || dragging;
  const shades = [
    { left: '0%', top: '0%', width: '100%', height: pct(rect.y) },
    { left: '0%', top: pct(rect.y + rect.h), width: '100%', height: pct(Math.max(0, 1 - rect.y - rect.h)) },
    { left: '0%', top: pct(rect.y), width: pct(rect.x), height: pct(rect.h) },
    { left: pct(rect.x + rect.w), top: pct(rect.y), width: pct(Math.max(0, 1 - rect.x - rect.w)), height: pct(rect.h) },
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4 overflow-x-hidden [scrollbar-gutter:stable]">
        {showOldFormat && start.oldFormat ? (
          // Hinweis, keine Warnung: ohne Folge vor dem Handeln, und Info-Blau gibt es nicht (Spec § 4, MUSTER § A).
          <Notice level="hint">{t('formatChanged', { old: start.oldFormat, new: ratioLabel(ratio) })}</Notice>
        ) : null}
        {/* Format: fest als ruhige Zeile in gleicher Höhe wie die Reihe — kein ausgegrautes Segment (Board 1b). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Overline as="span">{t('format')}</Overline>
          {fixed ? (
            <>
              <span data-testid="crop-format-fixed" className="inline-flex h-[var(--field-h)] items-center rounded-md border border-line bg-surface-2 px-3 text-meta font-semibold text-ink-2 max-sm:h-[46px]">
                {ratioLabel(formats[0]!)}
              </span>
              <span className="text-meta text-muted-ink">{t('fixed', { place: fixedReason ?? places[0]?.label ?? '' })}</span>
            </>
          ) : (
            <>
              <Segmented aria-label={t('format')} options={rowOptions} value={ratio} onValueChange={choose} testId="crop-format" />
              {turnable ? (
                <Segmented
                  aria-label={t('orientation')}
                  options={[
                    { value: 'landscape', label: t('landscape') },
                    { value: 'portrait', label: t('portrait') },
                  ]}
                  value={orientation}
                  onValueChange={turn}
                />
              ) : null}
            </>
          )}
        </div>
        <div className="flex gap-5 max-sm:flex-col">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {/*
              Telefon: Foto randlos über die Breite; höchstens 55 % der Bildschirmhöhe, dann mittig. Kein
              `overflow-hidden` an der Fläche: Die Griffe (44 px Trefferfläche) ragen am Bildrand hinaus — beim Öffnen
              liegt das Rechteck meist an zwei Kanten. Der Abstand ringsum (am Telefon 8 px statt randlos) hält den sichtbaren
              Griff im Dialog; was von der Trefferfläche darüber hinausragt, schneidet die Mitte waagerecht ab, ohne zu scrollen.
            */}
            <div className="p-2 max-sm:-mx-3 max-sm:px-0">
              <div
                ref={stage}
                data-testid="crop-stage"
                className="relative mx-auto touch-none select-none"
                style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, calc(55vh * ${width / height}))` }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
              >
                <img src={src} alt="" draggable={false} className="absolute inset-0 block size-full" />
                {shades.map((style, i) => (
                  <span key={i} aria-hidden className="pointer-events-none absolute bg-overlay/45" style={style} />
                ))}
                <div
                  ref={rectRef}
                  role="slider"
                  tabIndex={0}
                  aria-label={t('title')}
                  aria-valuemin={1}
                  aria-valuemax={maxZoom}
                  aria-valuenow={round2(zoom)}
                  aria-valuetext={valueText}
                  data-testid="crop-editor-rect"
                  onKeyDown={onKeyDown}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  className="absolute cursor-move border-2 border-on-brand outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
                >
                  {guides ? (
                    <>
                      {[1, 2].map((n) => (
                        <span key={`v${n}`} aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-on-brand/60" style={{ left: `${(n * 100) / 3}%` }} />
                      ))}
                      {[1, 2].map((n) => (
                        <span key={`h${n}`} aria-hidden className="pointer-events-none absolute inset-x-0 h-px bg-on-brand/60" style={{ top: `${(n * 100) / 3}%` }} />
                      ))}
                    </>
                  ) : null}
                  {/* Griffe: 14 px sichtbar, 44 px Fläche; sichtbar beim Ziehen und im Fokus. */}
                  {CORNERS.map((corner) => (
                    <span
                      key={corner}
                      aria-hidden
                      data-corner={corner}
                      className={cn(
                        'absolute size-3.5 rounded-xs border border-overlay/40 bg-on-brand after:absolute after:-inset-[15px] after:content-[""]',
                        corner === 'nw' && '-top-2 -left-2 cursor-nwse-resize',
                        corner === 'ne' && '-top-2 -right-2 cursor-nesw-resize',
                        corner === 'sw' && '-bottom-2 -left-2 cursor-nesw-resize',
                        corner === 'se' && '-right-2 -bottom-2 cursor-nwse-resize',
                        !guides && 'opacity-0',
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>
            {fine ? null : <p className="text-hint text-muted-ink">{t('touchHint')}</p>}
            <div className="flex items-center gap-2">
              <Overline as="span">{t('zoom')}</Overline>
              <Button type="button" variant="outline" size="icon" aria-label={t('smaller')} disabled={zoom <= 1 + 1e-6} onClick={() => resize(-STEP_ZOOM)}>
                <Minus aria-hidden />
              </Button>
              <input
                type="range"
                min={1}
                max={maxZoom}
                step={0.01}
                value={round2(zoom)}
                aria-label={t('zoom')}
                aria-valuetext={`${format.number(round2(zoom))}×`}
                onChange={(e) => setRect((c) => setZoom(c, g, Number(e.target.value), maxZoom))}
                className="h-11 min-w-0 flex-1 accent-brand"
              />
              <Button type="button" variant="outline" size="icon" aria-label={t('larger')} disabled={zoom >= maxZoom - 1e-6} onClick={() => resize(STEP_ZOOM)}>
                <Plus aria-hidden />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={cn('flex items-center gap-1 font-mono text-key tabular-nums', small ? 'text-warning' : 'text-ink-2')}>
                {small ? <AlertTriangle aria-hidden className="size-3.5 shrink-0" /> : null}
                {t('pixels', { width: String(pxW), height: String(pxH) })}
              </span>
              {fine ? <span className="font-mono text-key text-muted-ink">{t('keysHint')}</span> : null}
              {/* „Ganzes Format“, sobald gezoomt ist — auch ohne gespeicherten Ausschnitt (Designer 2026-10-10, e). */}
              {crop || zoomed ? (
                <span className="ml-auto flex flex-wrap gap-1">
                  {zoomed ? (
                    <Button type="button" variant="ghost" onClick={() => setRect((c) => fullFormat(c, g))}>
                      {t('full')}
                    </Button>
                  ) : null}
                  {crop ? (
                    <Button type="button" variant="ghost" onClick={remove}>
                      {t('remove')}
                    </Button>
                  ) : null}
                </span>
              ) : null}
            </div>
            {small ? (
              <Notice level="warn">
                <p>{t('smallNotice', { px: String(pxW) })}</p>
                {tooSmallFor.map((p, i) => (
                  <p key={i}>{t('smallFor', { place: p.label, max: String(p.minWidthPx) })}</p>
                ))}
                <p>{t('smallRemedies', { original: String(width < minWidthPx) })}</p>
              </Notice>
            ) : null}
          </div>
          {/*
            Rechner: rechts je Stelle das Ergebnis in deren Format, mit Namen (Board 1a/1c). Die Stellen kommen aus dem
            Template, nicht aus dem gewählten Format. Telefon: keine Vorschau, das zeigt danach Kachel oder Feld.
          */}
          {shown.length > 0 ? (
            <div className="flex w-44 shrink-0 flex-col gap-3 max-sm:hidden">
              <Overline as="span">{t('preview')}</Overline>
              {shown.map((p, i) => (
                <figure key={i} className="flex flex-col gap-1">
                  <CroppedImage src={src} crop={rect} ratio={p.ratio === 'original' ? `${Math.max(1, pxW)}:${Math.max(1, pxH)}` : p.ratio} />
                  <figcaption className="text-hint text-ink-2">{caption(p)}</figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </div>
        <p aria-live="polite" className="sr-only">
          {announced}
        </p>
      </DialogBody>
      <FormActionBar placement="dialog" cancel={() => onOpenChange(false)} onSave={apply} saveLabel={t('apply')} note={note} />
    </>
  );
}

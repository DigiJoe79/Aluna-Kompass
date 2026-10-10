'use client';

import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import type { ActionState } from '@/lib/actions';
import { runAction, toastNetwork, toastRefusal } from '@/lib/feedback';

/*
 * Ausnahme zu MUSTER § C (Freigabe Joe und Designer 2026-10-10, Spec Vorschläge § 6): Im Wisch-Stapel und bei der
 * Hauptaktion eines Hinweises heißt „Rückgängig“ „nicht abschicken“. Die Entscheidung bleibt 5 s im Browser; die
 * Quelle sieht nie eine zurückgenommene Entscheidung, und der Dienst braucht keine Frist. Der Zustand liegt auf
 * `globalThis`, damit er den Wechsel zum nächsten Vorschlag überlebt; schließt jemand die Seite, verfällt er —
 * der Vorschlag bleibt offen.
 */
export const HOLD_MS = 5_000;

export interface HeldDecision {
  /** Vorschlags-ID. */
  key: string;
  /** „Mira angenommen“. */
  message: string;
  /** „Rückgängig · 5“. */
  countdown: (seconds: number) => string;
  send: () => Promise<ActionState>;
  /** Erfolg oder Ablehnung, solange der Aufrufer noch da ist; ohne ihn geht eine Ablehnung an `toastRefusal`. */
  onSent?: (state: ActionState) => void;
  onUndo?: () => void;
  /** Text, wenn der Server nicht erreicht wird; die Entscheidung geht dann als Netzfehler an `onSent`, nie still verloren. */
  networkMessage?: string;
}

type Slot = { d: HeldDecision; timer: ReturnType<typeof setTimeout>; tick: ReturnType<typeof setInterval> };
type Store = { current: Slot | null; listeners?: Set<() => void> };
const store = (): Store => ((globalThis as { __kompassHeldDecision?: Store }).__kompassHeldDecision ??= { current: null });
const listeners = (): Set<() => void> => (store().listeners ??= new Set());
/** Setzt den Platz und sagt es den Abonnenten (Liste blendet den zurückgehaltenen Vorschlag aus). */
function setCurrent(slot: Slot | null): void {
  store().current = slot;
  for (const l of [...listeners()]) l();
}
const TOAST_ID = 'held-decision';

function send(slot: Slot): void {
  clearTimeout(slot.timer);
  clearInterval(slot.tick);
  void runAction(slot.d.send, slot.d.networkMessage ?? slot.d.message).then((state) => {
    if (slot.d.onSent) slot.d.onSent(state);
    else {
      toastNetwork(state, '');
      toastRefusal(state);
    }
  });
}

/** Schickt eine zurückgehaltene Entscheidung sofort ab (zweiter Wisch, „Fertig“, Wechsel auf die Prüfseite). */
export function flushHeldDecision(): void {
  const s = store();
  const slot = s.current;
  if (!slot) return;
  setCurrent(null);
  toast.dismiss(TOAST_ID);
  send(slot);
}

/** Hält `d` für `ms` zurück; eine schon zurückgehaltene geht vorher sofort ab. */
export function holdDecision(d: HeldDecision, ms = HOLD_MS): void {
  flushHeldDecision();
  const s = store();
  let left = Math.round(ms / 1000);
  const show = () =>
    toast(d.message, {
      id: TOAST_ID,
      duration: ms + 500,
      action: {
        label: d.countdown(left),
        onClick: () => {
          if (s.current?.d !== d) return;
          clearTimeout(s.current.timer);
          clearInterval(s.current.tick);
          setCurrent(null);
          d.onUndo?.();
        },
      },
    });
  const slot: Slot = {
    d,
    timer: setTimeout(() => {
      if (s.current !== slot) return;
      setCurrent(null);
      toast.dismiss(TOAST_ID);
      send(slot);
    }, ms),
    tick: setInterval(() => {
      left = Math.max(0, left - 1);
      if (s.current === slot) show();
    }, 1000),
  };
  setCurrent(slot);
  show();
}

export const heldKey = (): string | null => store().current?.d.key ?? null;

/** Meldet jeden Wechsel des zurückgehaltenen Vorschlags; gibt die Abmeldung zurück. */
export function subscribeHeld(listener: () => void): () => void {
  listeners().add(listener);
  return () => void listeners().delete(listener);
}

/**
 * Der gerade zurückgehaltene Vorschlag, reaktiv. Die Inbox blendet ihn aus, damit er nach „Vermittelt · offline ·
 * erledigt“ nicht 5 s lang offen wirkt — wie die Karte im Stapel, die sofort geht (M4).
 */
export function useHeldKey(): string | null {
  return useSyncExternalStore(subscribeHeld, heldKey, () => null);
}

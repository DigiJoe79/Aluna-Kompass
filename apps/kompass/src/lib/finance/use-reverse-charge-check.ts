'use client';

import type { ReverseChargeDeclineReason, ReverseChargePromptView } from '@kompass/module-finance';
import { useEffect, useRef, useState } from 'react';
import type { ActionState } from '@/lib/actions';
import { runAction } from '@/lib/feedback';
import type { ReverseChargeCheckInput } from './reverse-charge-prompt';

export interface ReverseChargeActions {
  check: (input: ReverseChargeCheckInput) => Promise<ReverseChargePromptView | null>;
  decline: (input: { contactId: string; reason: ReverseChargeDeclineReason; text?: string }) => Promise<ActionState>;
  /** „Künftig immer so“: das Merkmal am Kontakt setzen (`saveContactTaxDetails`). */
  mark: (input: { contactId: string; reverseCharge: 'eu' | 'other' }) => Promise<ActionState>;
}

/**
 * Prüffrage § 13b (Plan E6b Task 4) für Maske, Arbeitsliste und Rechnungsleser: fragt den Dienst nach jeder Änderung
 * von Kontakt, Beleg, Betrag oder Kennzeichen — entprellt, nur das Ergebnis für den letzten Stand zählt — und führt die
 * Antworten aus. „Ja“ ruft `onYes` (die Aufrufstelle setzt die Kennzeichen) und setzt mit `remember` das Merkmal am
 * Kontakt; „Nein“ merkt sich der Dienst je Kontakt, ohne Kontakt schließt die Frage bis zum nächsten Laden.
 */
export function useReverseChargePrompt(input: ReverseChargeCheckInput | null, actions: ReverseChargeActions, opts: { onYes: (prompt: ReverseChargePromptView) => void; networkMessage: string; delayMs?: number }) {
  const [prompt, setPrompt] = useState<ReverseChargePromptView | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<ActionState>({ status: 'idle' });
  const latest = useRef(0);
  const key = input && input.lines.some((l) => l.amountCents < 0) ? JSON.stringify(input) : null;
  const { check } = actions;
  const delayMs = opts.delayMs ?? 300;

  useEffect(() => {
    const ticket = ++latest.current;
    if (key === null) {
      setPrompt(null);
      return;
    }
    const timer = setTimeout(() => {
      void check(JSON.parse(key) as ReverseChargeCheckInput)
        .then((result) => {
          if (ticket === latest.current) setPrompt(result);
        })
        .catch(() => {
          if (ticket === latest.current) setPrompt(null);
        });
    }, delayMs);
    return () => clearTimeout(timer);
  }, [key, check, delayMs]);

  const shown = dismissed ? null : prompt;

  const yes = async ({ remember }: { remember: boolean }) => {
    if (!shown) return;
    opts.onYes(shown);
    setDismissed(true);
    if (remember && shown.contact) {
      const contactId = shown.contact.id;
      const saved = await runAction(() => actions.mark({ contactId, reverseCharge: shown.suggestedCode === 'rc13bEu' ? 'eu' : 'other' }), opts.networkMessage);
      setRefusal(saved.status === 'error' ? saved : { status: 'idle' });
    }
  };

  const no = async (reason: ReverseChargeDeclineReason, text?: string) => {
    if (!shown) return;
    if (!shown.contact) {
      setDismissed(true);
      return;
    }
    const contactId = shown.contact.id;
    setPending(true);
    const result = await runAction(() => actions.decline({ contactId, reason, text }), opts.networkMessage);
    setPending(false);
    setRefusal(result.status === 'error' ? result : { status: 'idle' });
    if (result.status !== 'error') setDismissed(true);
  };

  return { prompt: shown, pending, refusal, yes, no };
}

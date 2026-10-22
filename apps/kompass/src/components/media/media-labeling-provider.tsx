'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** Ohne Provider (Tests, Seiten außerhalb der Schale) darf niemand kennzeichnen: kein Schritt, kein Knopf. */
const MediaLabelingContext = createContext(false);

/**
 * „Darf kennzeichnen“ (Spec Bildkennzeichnung beim Hochladen, „Wer es sieht“): Bildkennzeichnung eingeschaltet **und**
 * Recht `media.upload`. Die Schale setzt den Wert einmal; Auswahldialog, Mediathek, Fotokachel und Bildfeld lesen ihn
 * über `useCanLabelMedia`. Fehlt eins, blenden sie Schritt und Knöpfe aus, statt sie zu sperren. Ein schlichter
 * Wahrheitswert: Er wechselt nicht bei jedem Zeichnen der Schale (vgl. `DateFormatProvider`).
 */
export function MediaLabelingProvider({ canLabel, children }: { canLabel: boolean; children: ReactNode }) {
  return <MediaLabelingContext.Provider value={canLabel}>{children}</MediaLabelingContext.Provider>;
}

export function useCanLabelMedia(): boolean {
  return useContext(MediaLabelingContext);
}

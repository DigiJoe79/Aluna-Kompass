'use client';

import { AlertTriangle, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SaveStatus } from '@/components/forms/save-status';
import { KeyChip } from '@/components/key-chip';
import { Button } from '@/components/ui/button';
import type { SaveState } from '@/lib/autosave';

/**
 * Lageleiste des Mitlaufs (N2, Freigabe Joe 2026-10-28, Board Gremien 1a/1e/1h): Titel, Stimmberechtigte als Knopf
 * (öffnet die Anwesenheit, Taste A), Beschlussfähigkeit als Ton-Text, Speicherzustand, „Mitlauf beenden …“. Gilt für
 * den Punkt eine eigene Zahl (Entlastung ohne Betroffene), steht sie mit „bei TOP n“. Klebt oben im Inhalt; am Telefon
 * eine Zeile ohne Titel. Nicht beschlussfähig ist `warning`, nie eine Sperre und nie `alert`. Klebt bündig am oberen Rand
 * des Inhaltsbereichs (über dessen Innenabstand, wie `folder-column`), sonst rollt der Inhalt — etwa die Überschrift
 * „Feststellungen“ — sichtbar über der Leiste vorbei (Bilder 0.5.0; Einzelstelle, ohne Layout-Test).
 */
export function QuorumStrip({
  title,
  voting,
  guests,
  scope,
  quorum,
  save,
  onAttendance,
  onEnd,
}: {
  title: string;
  voting: number;
  guests: number;
  scope: { label: string; present: number } | null;
  quorum: { required: number | null; met: boolean | null; knife: boolean };
  save: { state: SaveState; pending: boolean };
  onAttendance: () => void;
  onEnd: (() => void) | null;
}) {
  const t = useTranslations('governance.live.strip');
  const count = scope ? t('scoped', { count: scope.present, scope: scope.label, present: voting }) : t('voting', { count: voting });
  return (
    <div role="region" aria-label={t('region')} data-testid="quorum-strip" className="sticky top-[calc(var(--shell-pad)*-1)] z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface py-2">
      <span className="text-body font-semibold text-ink max-sm:hidden">{title}</span>
      <Button type="button" variant="outline" size="sm" onClick={onAttendance} data-testid="strip-attendance">
        {count}
        <KeyChip label={t('attendance')}>A</KeyChip>
      </Button>
      {guests > 0 ? <span className="text-meta text-muted-ink">{t('guests', { count: guests })}</span> : null}
      {quorum.required === null ? (
        <span className="text-meta text-muted-ink">{t('noQuorum')}</span>
      ) : quorum.met ? (
        <span className="inline-flex items-center gap-1 text-meta text-success" data-testid="strip-quorum">
          <Check className="size-3.5" aria-hidden />
          {quorum.knife ? t('quorumExact', { required: quorum.required }) : t('quorumMet', { required: quorum.required })}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-meta text-warning" data-testid="strip-quorum">
          <AlertTriangle className="size-3.5" aria-hidden />
          {t('quorumNotMet', { required: quorum.required })}
        </span>
      )}
      <span className="ml-auto flex items-center gap-3">
        {/* Beim Laden ist der Zustand `idle`, auch wenn die Sitzung längst Gezähltes hat — dann steht nichts da. */}
        <SaveStatus state={save.state} pending={save.pending} quietWhenIdle />
        {onEnd ? (
          <Button type="button" variant="outline" size="sm" onClick={onEnd} data-testid="strip-end">
            {t('end')}
          </Button>
        ) : null}
      </span>
    </div>
  );
}

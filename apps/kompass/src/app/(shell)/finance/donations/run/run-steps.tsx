'use client';

import { useTranslations } from 'next-intl';
import { Steps, stepsFrom } from '@/components/steps';
import { RUN_STEPS, type RunStep } from '@/lib/finance/run';

/**
 * Der Schrittkopf des Serienlaufs (README 3i, Entwurf E3): Auswahl · Vorschau · Lauf · Ergebnis als Leiste. Auf dem
 * Ergebnis ist der Lauf durch — „alle erledigt“ statt eines aktiven letzten Schritts mit Nummer.
 */
export function RunSteps({ active }: { active: RunStep }) {
  const t = useTranslations('finance.donations.run.steps');
  return <Steps label={t('label')} steps={stepsFrom(RUN_STEPS.map((key) => ({ key, label: t(key) })), active === 'result' ? null : active)} />;
}

'use client';

import { useTranslations } from 'next-intl';
import { GuidedSteps, guidedSteps } from '@/components/guided-steps';
import { RUN_STEPS, type RunStep } from '@/lib/finance/run';

/** Der Schrittkopf des Serienlaufs (README 3i): Auswahl · Vorschau · Lauf · Ergebnis. */
export function RunSteps({ active }: { active: RunStep }) {
  const t = useTranslations('finance.donations.run.steps');
  return <GuidedSteps label={t('label')} steps={guidedSteps(RUN_STEPS.map((key) => ({ key, label: t(key) })), active)} />;
}

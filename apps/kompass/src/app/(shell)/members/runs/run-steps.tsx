'use client';

import { useTranslations } from 'next-intl';
import { Steps, stepsFrom } from '@/components/steps';

export type MemberRunStep = 'selection' | 'preview' | 'run' | 'dispatch';
const STEPS: readonly MemberRunStep[] = ['selection', 'preview', 'run', 'dispatch'];

/** Schrittkopf der Läufe (Handoff Mitglieder 2.5): Auswahl · Vorschau · Lauf · Versand; `null`, wenn alles erledigt ist. */
export function RunSteps({ active }: { active: MemberRunStep | null }) {
  const t = useTranslations('members.runs.steps');
  return <Steps label={t('label')} steps={stepsFrom(STEPS.map((key) => ({ key, label: t(key) })), active)} />;
}

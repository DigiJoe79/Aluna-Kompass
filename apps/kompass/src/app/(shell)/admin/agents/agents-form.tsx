'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { AgentSwitchSection } from '../agent-switch-section';
import { saveAgentSwitchesAction } from './actions';

export interface AgentSwitchRow {
  key: string;
  value: boolean;
}

/** Der Textbereich eines Schalters: der erste Teil seines Schlüssels (`governance.mcpHumanOnlyAllowed` → `governance`). */
export function agentSwitchArea(key: string): string {
  return key.split('.')[0]!;
}

/**
 * Verwaltung → Agenten (Spec 2026-10-29): eine Karte, je Schalter ein Abschnitt mit dem Namen des Moduls, darunter die
 * Speicherleiste. Gespeichert wird nur, was sich geändert hat; „Verwerfen“ setzt das Formular zurück, die Schalter
 * hören auf dessen `reset`. Die Texte kommen aus `admin.agents.switches.<Bereich>` — der Bereich ist der erste Teil des
 * Schlüssels, so erscheint ein neues Modul mit Schalter ohne Eintrag hier.
 */
export function AgentsForm({ switches }: { switches: AgentSwitchRow[] }) {
  const t = useTranslations('admin.agents');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const saved = Object.fromEntries(switches.map((s) => [s.key, s.value]));
  const [current, setCurrent] = useState<Record<string, boolean>>(saved);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const changed = switches.filter((s) => (current[s.key] ?? s.value) !== s.value).map((s) => s.key);

  const save = async () => {
    if (changed.length === 0) return;
    setPending(true);
    const result = await feedback.run(() => saveAgentSwitchesAction(Object.fromEntries(changed.map((key) => [key, current[key]!]))), { retry: () => void save() });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  return (
    <FormCard
      as="form"
      ref={form}
      data-testid="agent-switches"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void save();
      }}
      onChange={(e: React.FormEvent) => {
        const target = e.target;
        if (target instanceof HTMLInputElement && target.name in saved) setCurrent((prev) => ({ ...prev, [target.name]: target.checked }));
      }}
    >
      <FormCardBody>
        {switches.map((s) => {
          const area = agentSwitchArea(s.key);
          return (
            <AgentSwitchSection
              key={s.key}
              title={t(`switches.${area}.title`)}
              name={s.key}
              label={t(`switches.${area}.label`)}
              hint={t(`switches.${area}.hint`)}
              checked={s.value}
              disabled={pending}
            />
          );
        })}
      </FormCardBody>
      <FormActionBar
        count={changed.length}
        pending={pending}
        state={feedback.state}
        saveTestId="agent-switches-save"
        onDiscard={() => {
          setCurrent(saved);
          form.current?.reset();
          feedback.reset();
        }}
        onSave={() => void save()}
      />
    </FormCard>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Section } from '@/components/section';
import { Switch } from '@/components/ui/switch';

/**
 * Der Abschnitt „Agent“ eines Einstellungsformulars (Nachtrag MCP-Test § 1, Designer 2026-10-19; Plan U4 Task 1):
 * die Erlaubnis für Agenten, eine `uiOnly`-Einstellung `…mcpHumanOnlyAllowed`. Immer der letzte Abschnitt vor der
 * `FormActionBar` und **mit dem Formular gespeichert, nicht sofort**: Der Schalter trägt `name` (den Schlüssel der
 * Einstellung) und meldet sich als Feld des Formulars — die Änderung kommt über das `change`-Ereignis beim Formular
 * an, ein `reset` des Formulars („Verwerfen“) stellt den gespeicherten Stand wieder her. Kein eigener Titel, keine
 * eigene Karte; die Beschriftung ist die Frage „Darf ein Agent …?“, der Hinweis sagt in einem Satz, was ein Mensch
 * weiter entscheidet.
 */
export function AgentSwitchSection({ name, label, hint, checked, disabled }: { name: string; label: string; hint: string; checked: boolean; disabled?: boolean }) {
  const t = useTranslations('common.agentSwitch');
  const [value, setValue] = useState(checked);
  // Nach dem Speichern und `router.refresh()` kommt ein neuer gespeicherter Stand.
  const [saved, setSaved] = useState(checked);
  if (saved !== checked) {
    setSaved(checked);
    setValue(checked);
  }
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const onReset = () => setValue(checked);
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, [checked]);
  const id = `agent-switch-${name.replace(/\./g, '-')}`;
  return (
    <Section title={t('title')}>
      <FormGrid>
        <FormField id={id} label={label} hint={hint} size="full" toggle>
          <Switch ref={ref} id={id} name={name} checked={value} disabled={disabled} onCheckedChange={setValue} />
        </FormField>
      </FormGrid>
    </Section>
  );
}

/** Der Wert des Schalters aus dem `change`-Ereignis eines Formulars — `null`, wenn das Ereignis von einem anderen Feld kommt. */
export function agentSwitchChange(event: { target: EventTarget | null }, name: string): boolean | null {
  const target = event.target;
  return target instanceof HTMLInputElement && target.name === name ? target.checked : null;
}

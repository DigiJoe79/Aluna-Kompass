'use client';

import { useEffect, useRef, useState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Section } from '@/components/section';
import { Switch } from '@/components/ui/switch';

/**
 * Ein Abschnitt der Seite Verwaltung → Agenten (Nachtrag MCP-Test § 1, Designer 2026-10-19; Spec Seite „Agenten“
 * 2026-10-29): die Erlaubnis für Agenten eines Moduls, eine `uiOnly`-Einstellung `…mcpHumanOnlyAllowed`, mit dem
 * Modulnamen als Titel. **Mit dem Formular gespeichert, nicht sofort**: Der Schalter trägt `name` (den Schlüssel der
 * Einstellung) und meldet sich als Feld des Formulars — die Änderung kommt über das `change`-Ereignis beim Formular
 * an, ein `reset` des Formulars („Verwerfen“) stellt den gespeicherten Stand wieder her. Keine eigene Karte; die
 * Beschriftung ist die Frage „Darf ein Agent …?“, der Hinweis sagt in einem Satz, was ein Mensch weiter entscheidet.
 */
export function AgentSwitchSection({ title, name, label, hint, checked, disabled }: { title: string; name: string; label: string; hint: string; checked: boolean; disabled?: boolean }) {
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
    <Section title={title}>
      <FormGrid>
        <FormField id={id} label={label} hint={hint} size="full" toggle>
          <Switch ref={ref} id={id} name={name} checked={value} disabled={disabled} onCheckedChange={setValue} />
        </FormField>
      </FormGrid>
    </Section>
  );
}

'use client';

import { FormField } from '@/components/forms/form-field';
import { Switch } from '@/components/ui/switch';

/**
 * Der Schalter „Jede Nacht ein Backup erstellen“ als Feld des Rasters. Eigene Datei, weil der Wächter
 * `ui-only-settings` jede Datei mit einem `Switch` und dem Agentenschalter als Nachbau von `AgentSwitchSection` liest.
 */
export function ScheduleSwitch({ name, label, hint, error, checked, disabled }: { name: string; label: string; hint: string; error?: string; checked: boolean; disabled: boolean }) {
  return (
    <FormField id="backup-schedule-enabled" label={label} hint={hint} error={error} size="full" toggle>
      <Switch id="backup-schedule-enabled" name={name} defaultChecked={checked} disabled={disabled} />
    </FormField>
  );
}

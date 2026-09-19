'use client';

import type { FieldSchema } from '@kompass/module-site/client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { SchemaForm, withBlanks } from '@/components/schema-form';
import { idleState } from '@/lib/actions';
import { changedValues, countChangedValues } from '@/lib/form-dirty';
import { saveVariablesAction } from '../actions';

export function VariablesForm({
  schema,
  value,
  version,
  locales,
  options,
}: {
  schema: Record<string, FieldSchema>;
  value: Record<string, unknown>;
  /** Ladestand (`valuesVersion`) — der Dienst weist ein Speichern auf altem Stand ab. */
  version: string;
  locales: string[];
  options: Record<string, { value: string; label: string }[]>;
}) {
  const t = useTranslations('site.variables');
  const [current, setCurrent] = useState(() => withBlanks(schema, value, locales));
  const [loaded, setLoaded] = useState(current);
  const changedCount = countChangedValues(loaded, current);
  const [state, action] = useActionState(saveVariablesAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message ?? '');
      setLoaded(current);
    } else if (state.status === 'error' && Object.keys(errors).length === 0) {
      toast.error(state.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, errors]);

  return (
    <form action={action} className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-6">
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="payload" value={JSON.stringify(changedValues(loaded, current))} />
      <SchemaForm schema={schema} value={current} errors={errors} locales={locales} onChange={setCurrent} options={options} />
      <FormActionBar count={changedCount} onDiscard={() => setCurrent(loaded)} />
    </form>
  );
}

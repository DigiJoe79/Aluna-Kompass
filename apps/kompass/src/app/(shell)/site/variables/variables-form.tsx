'use client';

import type { FieldSchema } from '@kompass/module-site/client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <FormCard as="form" action={action}>
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="payload" value={JSON.stringify(changedValues(loaded, current))} />
      <FormCardBody>
        <SchemaForm schema={schema} value={current} errors={errors} locales={locales} onChange={setCurrent} options={options} />
      </FormCardBody>
      <FormActionBar count={changedCount} onDiscard={() => setCurrent(loaded)} state={state} />
    </FormCard>
  );
}

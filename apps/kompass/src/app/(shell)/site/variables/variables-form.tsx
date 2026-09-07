'use client';

import type { FieldSchema } from '@kompass/module-site/client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SubmitButton } from '@/components/forms/submit-button';
import { SchemaForm, withBlanks } from '@/components/schema-form';
import { idleState } from '@/lib/actions';
import { saveVariablesAction } from '../actions';

export function VariablesForm({ schema, value, locales }: { schema: Record<string, FieldSchema>; value: Record<string, unknown>; locales: string[] }) {
  const t = useTranslations('site.variables');
  const [current, setCurrent] = useState(() => withBlanks(schema, value, locales));
  const [state, action] = useActionState(saveVariablesAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};

  useEffect(() => {
    if (state.status === 'success') toast.success(state.message ?? '');
    else if (state.status === 'error' && Object.keys(errors).length === 0) toast.error(state.message);
  }, [state, errors]);

  return (
    <form action={action} className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-6">
      <input type="hidden" name="payload" value={JSON.stringify(current)} />
      <SchemaForm schema={schema} value={current} errors={errors} locales={locales} onChange={setCurrent} />
      <div className="flex justify-end">
        <SubmitButton>{t('save')}</SubmitButton>
      </div>
    </form>
  );
}

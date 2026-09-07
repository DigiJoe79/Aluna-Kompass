'use client';

import type { FieldSchema } from '@kompass/module-site/client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { SchemaForm, withBlanks } from '@/components/schema-form';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { saveEntryAction } from '../../actions';

interface Entry {
  id: string;
  slug: string | null;
  data: Record<string, unknown>;
}

export function EntryForm({
  collection,
  fields,
  hasSlug,
  entry,
  locales,
}: {
  collection: string;
  fields: Record<string, FieldSchema>;
  hasSlug: boolean;
  entry: Entry | null;
  locales: string[];
}) {
  const t = useTranslations('site.entries');
  const c = useTranslations('website.common');
  const [data, setData] = useState(() => withBlanks(fields, entry?.data ?? {}, locales));
  const [slug, setSlug] = useState(entry?.slug ?? '');
  const [state, action] = useActionState(saveEntryAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};

  useEffect(() => {
    if (state.status === 'success') toast.success(state.message ?? '');
    else if (state.status === 'error' && Object.keys(errors).length === 0) toast.error(state.message);
  }, [state, errors]);

  return (
    <form action={action} className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-6">
      <input type="hidden" name="collection" value={collection} />
      {entry ? <input type="hidden" name="id" value={entry.id} /> : null}
      <input type="hidden" name="payload" value={JSON.stringify({ slug: hasSlug ? slug : undefined, data })} />
      {hasSlug ? (
        <FormField id="slug" label={c('slug')} error={errors.slug}>
          <Input id="slug" name="slug" value={slug} onChange={(e) => setSlug(e.target.value)} pattern="[a-z0-9][a-z0-9-]{0,80}" className="font-mono" />
        </FormField>
      ) : null}
      <SchemaForm schema={fields} value={data} errors={errors} locales={locales} onChange={setData} />
      <div className="flex justify-end">
        <SubmitButton>{t('save')}</SubmitButton>
      </div>
    </form>
  );
}

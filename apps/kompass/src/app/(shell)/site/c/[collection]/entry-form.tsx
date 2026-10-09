'use client';

import type { FieldSchema } from '@kompass/module-site/client';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { SchemaForm, withBlanks } from '@/components/schema-form';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { countChangedValues } from '@/lib/form-dirty';
import { saveEntryAction } from '../../actions';

interface Entry {
  id: string;
  slug: string | null;
  data: Record<string, unknown>;
  /** Ladestand (`updatedAt`) — der Dienst weist ein Speichern auf altem Stand ab. */
  updatedAt: string;
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
  const c = useTranslations('content');
  const tCommon = useTranslations('common');
  const [data, setData] = useState(() => withBlanks(fields, entry?.data ?? {}, locales));
  const [slug, setSlug] = useState(entry?.slug ?? '');
  const [loaded, setLoaded] = useState({ data, slug });
  const [version, setVersion] = useState(entry?.updatedAt ?? '');
  const changedCount =
    countChangedValues(loaded.data, data) + (loaded.slug === slug ? 0 : 1);
  const discard = () => {
    setData(loaded.data);
    setSlug(loaded.slug);
  };
  const [state, action] = useActionState(saveEntryAction, idleState);
  // `useMemo`, weil `errors` sonst bei jedem Render ein neues Objekt waere und
  // der Effekt unten damit bei jedem Render feuerte statt nur bei einer
  // Zustandsaenderung — der Toast erschiene mehrfach.
  const errors = useMemo(() => (state.status === 'error' ? state.fieldErrors : {}), [state]);

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message ?? '');
      // Der gespeicherte Stand ist der neue Ladestand: Leiste leer, „Verwerfen“
      // führt hierher zurück, und das nächste Speichern prüft gegen diese Version.
      setLoaded({ data, slug });
      const saved = (state.data as { updatedAt?: string } | undefined)?.updatedAt;
      if (saved) setVersion(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur bei neuem Aktionsstand
  }, [state]);

  return (
    <FormCard as="form" action={action}>
      <input type="hidden" name="collection" value={collection} />
      {entry ? <input type="hidden" name="id" value={entry.id} /> : null}
      {entry ? <input type="hidden" name="expectedVersion" value={version} /> : null}
      <input type="hidden" name="payload" value={JSON.stringify({ slug: hasSlug ? slug : undefined, data })} />
      <FormCardBody>
        <SchemaForm
          schema={fields}
          value={data}
          errors={errors}
          locales={locales}
          onChange={setData}
          leading={
            hasSlug ? (
              <FormField id="slug" label={c('slug')} error={errors.slug}>
                <Input id="slug" name="slug" value={slug} onChange={(e) => setSlug(e.target.value)} pattern="[a-z0-9][a-z0-9-]{0,80}" className="font-mono" />
              </FormField>
            ) : null
          }
        />
      </FormCardBody>
      <FormActionBar
        mode={entry ? 'edit' : 'create'}
        back={{ href: `/site/c/${collection}`, label: tCommon('backToList') }}
        count={changedCount}
        onDiscard={discard}
        state={state}
      />
    </FormCard>
  );
}

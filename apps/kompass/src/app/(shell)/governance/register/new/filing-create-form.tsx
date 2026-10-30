'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { createFilingAction } from '../actions';

export function FilingCreateForm({ occasions }: { occasions: { ref: { id: string } | { termId: string } | { statuteId: string }; key: string; label: string }[] }) {
  const t = useTranslations('governance.register');
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>(occasions.map((o) => o.key));
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => createFilingAction(occasions.filter((o) => chosen.includes(o.key)).map((o) => o.ref), note.trim() || null), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message ?? '');
    router.push(`/governance/register/${(result.data as { id: string }).id}`);
  };
  return (
    <FormCard>
      <FormCardBody>
        <Section title={t('occasionsSection')} intro={occasions.length === 0 ? t('noOpenOccasions') : undefined}>
          <FormGrid>
            {occasions.map((o) => (
              <FormField key={o.key} id={`occasion-${o.key}`} label={o.label} size="full" toggle>
                <Checkbox id={`occasion-${o.key}`} checked={chosen.includes(o.key)} onCheckedChange={(c) => setChosen((list) => (c ? [...list, o.key] : list.filter((x) => x !== o.key)))} />
              </FormField>
            ))}
            <FormField id="filing-note" label={t('note')} size="full">
              <Textarea id="filing-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          </FormGrid>
        </Section>
      </FormCardBody>
      <FormActionBar mode="create" onSave={() => void save()} pending={pending} state={feedback.state} back={{ href: '/governance/register', label: t('title') }} />
    </FormCard>
  );
}

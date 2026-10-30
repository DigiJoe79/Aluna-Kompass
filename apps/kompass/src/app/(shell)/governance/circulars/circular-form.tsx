'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Section } from '@/components/section';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { detailsDraft, detailsPayload, isDetailsKind, type DetailsDraft, type DetailsKind } from '@/lib/governance/resolution-details';
import { ResolutionDetailsFields, type DetailsOptions } from '../resolution-details-fields';
import { createCircularAction } from './actions';

const CHANNELS = ['email', 'messenger', 'letter'] as const;

/** Umlauf anlegen (Vorgang, eigene Seite wie „Sitzung anlegen“). */
export function CircularForm({ organs, defaultOrganId, kinds, today, options }: { organs: { id: string; name: string }[]; defaultOrganId: string; kinds: string[]; today: string; options: DetailsOptions }) {
  const t = useTranslations('governance.circular');
  const tk = useTranslations('governance.agendaKinds');
  const router = useRouter();
  const [organId, setOrganId] = useState(defaultOrganId);
  const [kind, setKind] = useState('simple');
  const [text, setText] = useState('');
  const [details, setDetails] = useState<DetailsDraft[DetailsKind] | null>(null);
  const [requestedOn, setRequestedOn] = useState(today);
  const [deadline, setDeadline] = useState('');
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('email');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const save = async () => {
    const payload = isDetailsKind(kind) && details ? detailsPayload(kind, details) : null;
    setPending(true);
    const result = await feedback.run(() => createCircularAction({ organId, kind, text, ...(payload ? { details: payload } : {}), requestedOn, deadline, channel }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(result.message ?? '');
    router.push(`/governance/circulars/${(result.data as { id: string }).id}`);
  };
  return (
    <FormCard>
      <FormCardBody>
        <Section title={t('request')}>
          <FormGrid>
            <FormField id="circular-organ" label={t('organ')} required error={errors.organId}>
              <Select id="circular-organ" value={organId} onChange={(e) => setOrganId(e.target.value)}>
                {organs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </FormField>
            <FormField id="circular-kind" label={t('kind')} required error={errors.kind}>
              <Select id="circular-kind" value={kind} onChange={(e) => { setKind(e.target.value); setDetails(isDetailsKind(e.target.value) ? detailsDraft(e.target.value, null) : null); }}>
                {kinds.map((k) => <option key={k} value={k}>{tk(k)}</option>)}
              </Select>
            </FormField>
            <FormField id="circular-text" label={t('text')} required size="full" error={errors.text}>
              <Textarea id="circular-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
            </FormField>
            {isDetailsKind(kind) && details ? (
              <FormCell size="full">
                <ResolutionDetailsFields id="circular-details" kind={kind} organId={organId} draft={details} onChange={setDetails} options={options} decidedOn={requestedOn} />
              </FormCell>
            ) : null}
            <FormField id="circular-requested" label={t('requestedOn')} required size="s" error={errors.requestedOn}>
              <Input id="circular-requested" type="date" value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} />
            </FormField>
            <FormField id="circular-deadline" label={t('deadline')} required size="s" error={errors.deadline}>
              <Input id="circular-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </FormField>
            <FormField id="circular-channel" label={t('channel')} size="m">
              <Segmented<(typeof CHANNELS)[number]> className="self-start" aria-label={t('channel')} value={channel} onValueChange={setChannel} options={CHANNELS.map((c) => ({ value: c, label: t(`channels.${c}`) }))} />
            </FormField>
          </FormGrid>
        </Section>
      </FormCardBody>
      <FormActionBar mode="create" onSave={() => void save()} pending={pending} state={feedback.state} back={{ href: '/governance/circulars', label: t('back') }} saveTestId="circular-create-save" />
    </FormCard>
  );
}

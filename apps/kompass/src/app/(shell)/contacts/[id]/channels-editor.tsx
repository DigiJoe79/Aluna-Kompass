'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { setContactChannelsAction } from '../actions';
import { Select } from '@/components/ui/select';
import { Section } from '@/components/section';
import { Empty } from '@/components/empty-value';

type ChannelKind = 'email' | 'phone' | 'mobile' | 'fax' | 'web';

export function ChannelsEditor({
  contactId,
  contactName,
  channels,
  canManage,
}: {
  contactId: string;
  /** Der Untertitel des Dialogs nennt den Kontakt statt den Abschnitt zu wiederholen (04 A3). */
  contactName: string;
  channels: { id: string; kind: string; value: string; label: string | null; isPrimary: boolean }[];
  canManage: boolean;
}) {
  const t = useTranslations('contacts');
  const c = useTranslations('common');

  const [addOpen, setAddOpen] = useState(false);
  const [kind, setKind] = useState<ChannelKind>('email');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [isPrimary, setIsPrimary] = useState(channels.length === 0);
  const [pending, startTransition] = useTransition();
  const addFb = useActionFeedback();
  // „Entfernen“ steht in den Zeilen der Liste: Die Ablehnung steht über der Liste.
  const removeFb = useActionFeedback();

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    const current = channels.map((ch) => ({
      kind: ch.kind as ChannelKind,
      value: ch.value,
      label: ch.label,
      isPrimary: isPrimary ? false : ch.isPrimary,
    }));
    const nextChannels = [...current, { kind, value: value.trim(), label: label.trim() || null, isPrimary }];
    startTransition(async () => {
      const result = await addFb.run(() => setContactChannelsAction(contactId, nextChannels));
      if (result.status !== 'success') return;
      setValue('');
      setLabel('');
      setIsPrimary(false);
      setAddOpen(false);
    });
  };

  const handleRemove = (channelId: string) => {
    const nextChannels = channels
      .filter((ch) => ch.id !== channelId)
      .map((ch) => ({
        kind: ch.kind as ChannelKind,
        value: ch.value,
        label: ch.label,
        isPrimary: ch.isPrimary,
      }));
    startTransition(async () => {
      await removeFb.run(() => setContactChannelsAction(contactId, nextChannels), { retry: () => handleRemove(channelId) });
    });
  };

  return (
    <section className="rounded-md border border-line bg-surface p-5">
      <Section title={t('channels.title')}
        actions={
          <>
            {canManage ? (
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger
                  render={
                    <Button size="sm" variant="outline">
                      {t('channels.add')}
                    </Button>
                  }
                />
                <DialogContent size="sm" className="bg-surface shadow-md">
                  <form onSubmit={handleAdd}>
                    <DialogTitle>{t('channels.add')}</DialogTitle>
                    <DialogDescription>{t('forContact', { name: contactName })}</DialogDescription>

                    <div className="mt-4">
                      <FormGrid>
                        <FormField id="channel-kind" label={t('channels.kind')} size="s">
                          <Select
                            id="channel-kind"
                            value={kind}
                            onChange={(e) => setKind(e.target.value as ChannelKind)}
                          >
                            <option value="email">{t('channels.kinds.email')}</option>
                            <option value="phone">{t('channels.kinds.phone')}</option>
                            <option value="mobile">{t('channels.kinds.mobile')}</option>
                            <option value="fax">{t('channels.kinds.fax')}</option>
                            <option value="web">{t('channels.kinds.web')}</option>
                          </Select>
                        </FormField>

                        <FormField id="channel-value" label={t('channels.value')} required>
                          <Input
                            id="channel-value"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            required
                            placeholder={kind === 'email' ? 'name@example.org' : kind === 'web' ? 'https://...' : '+49...'}
                          />
                        </FormField>

                        <FormField id="channel-label" label={t('channels.label')} size="s">
                          <Input
                            id="channel-label"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder={t('channelLabelPlaceholder')}
                          />
                        </FormField>

                        <FormField id="channel-primary" label={t('channels.isPrimary')} toggle>
                          <Checkbox
                            id="channel-primary"
                            checked={isPrimary}
                            onCheckedChange={(c) => setIsPrimary(Boolean(c))}
                          />
                        </FormField>
                      </FormGrid>
                    </div>

                    <FormActionBar placement="dialog" mode="create" cancel={() => setAddOpen(false)} pending={pending} saveLabel={t('channels.save')} state={addFb.state} />
                  </form>
                </DialogContent>
              </Dialog>
            ) : null}
          </>
        }
      >
        <RefusalNotice action state={removeFb.state} />

        {channels.length === 0 ? (
          <p className="text-meta text-muted-ink"><Empty /></p>
        ) : (
          <ul className="divide-y divide-line-2">
            {channels.map((ch) => (
              <li key={ch.id} className="flex items-center justify-between gap-4 py-2.5">
                {/* `min-w-0 flex-wrap` und `wrap-anywhere` (wie im Protokoll): Marke, lange E-Mail und „bevorzugt“ liefen auf
                    dem Telefon über den Rand (`main` 467 > 390 px, release-0.2.7.md, Befund 17); jetzt bricht die Zeile
                    um, die Adresse notfalls in sich. Kein Layout-Test für diese Einzelstelle (AGENTS.md). */}
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <StatusBadge tone="neutral">{t(`channels.kinds.${ch.kind}`)}</StatusBadge>
                  <span className="min-w-0 text-meta wrap-anywhere text-ink">{ch.value}</span>
                  {ch.label ? <span className="text-hint text-muted-ink">({ch.label})</span> : null}
                  {ch.isPrimary ? (
                    <StatusBadge tone="brand" dot>
                      {t('channels.isPrimary')}
                    </StatusBadge>
                  ) : null}
                </div>
                {/* Zeilenaktion als Text wie „Beenden“ bei den Rollen (04 B14), neutral nach § C. */}
                {canManage ? (
                  <Button size="sm" variant="outline" onClick={() => handleRemove(ch.id)} disabled={pending} className="shrink-0">
                    {t('channels.remove')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </section>
  );
}

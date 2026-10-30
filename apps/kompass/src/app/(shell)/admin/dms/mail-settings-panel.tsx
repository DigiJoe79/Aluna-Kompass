'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { saveMailSettingsAction, sendTestMailAction, setMailBodySnippetAction } from './actions';

export interface MailSettingsProps {
  mail: { kind: 'off' | 'ready' | 'redirect' | 'blocked'; host: string | null; redirectTo: string | null };
  values: { fromAddress: string; fromName: string; replyTo: string; ratePerMinute: number };
  types: { key: string; label: string }[];
  snippets: { id: string; name: string }[];
  byType: Record<string, string>;
  defaultSnippetId: string | null;
  canManageSettings: boolean;
  canSend: boolean;
}

/**
 * Einstellungen › Akte › Versand › E-Mail (Handoff 2b E5, 22a/22b): unter der Tabelle der Versandwege ein Abschnitt
 * „E-Mail“ mit „Testmail an mich senden“, eine Formularkarte „Absender“ (Verbindung als fester Wert, Adresse und Name
 * Pflicht, Antwortadresse, Höchstens je Minute) und die Tabelle Begleittext je Dokumentart. Testumgebung als `warn`,
 * nicht eingerichtet als `hint` über dem Formular, die Felder dann gesperrt.
 */
export function MailSettingsPanel({ mail, values, types, snippets, byType, defaultSnippetId, canManageSettings, canSend }: MailSettingsProps) {
  const t = useTranslations('dms.admin.mail');
  const router = useRouter();
  const [form, setForm] = useState(values);
  const [pending, setPending] = useState(false);
  const saveFb = useActionFeedback();
  const testFb = useActionFeedback();
  const [testing, setTesting] = useState(false);
  const [choosing, setChoosing] = useState<{ key: string; label: string } | null>(null);
  const off = mail.kind === 'off';
  const locked = off || !canManageSettings;
  const changed = (Object.keys(values) as (keyof typeof values)[]).filter((k) => String(form[k]) !== String(values[k])).length;

  const save = async () => {
    setPending(true);
    const result = await saveFb.run(
      () => saveMailSettingsAction({ fromAddress: form.fromAddress.trim(), fromName: form.fromName.trim(), replyTo: form.replyTo.trim() || null, ratePerMinute: Number(form.ratePerMinute) }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  const test = async () => {
    setTesting(true);
    await testFb.run(() => sendTestMailAction(), { retry: () => void test() });
    setTesting(false);
  };

  const errors = saveFb.state.status === 'error' ? (saveFb.state.fieldErrors ?? {}) : {};
  const snippetName = (id: string | null | undefined) => snippets.find((s) => s.id === id)?.name ?? null;
  const defaultLabel = t('defaultSuffix', { name: snippetName(defaultSnippetId) ?? t('builtIn') });
  const connection = mail.kind === 'ready' ? t('state.ready', { host: mail.host ?? '' }) : mail.kind === 'redirect' ? t('state.redirect', { to: mail.redirectTo ?? '' }) : t(`state.${mail.kind}`);

  return (
    <div className="space-y-4" data-testid="mail-settings">
      <Section
        title={t('title')}
        actions={
          canSend ? (
            <Button type="button" variant="outline" size="sm" disabled={off || testing} onClick={() => void test()} data-testid="mail-test">
              {t('test')}
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <RefusalNotice action state={testFb.state} />
          {mail.kind === 'redirect' ? <Notice level="warn" title={t('redirectTitle')}>{t('redirectText', { to: mail.redirectTo ?? '' })}</Notice> : null}
          {mail.kind === 'blocked' ? <Notice level="warn" title={t('redirectTitle')}>{t('blockedText')}</Notice> : null}
          {off ? <Notice level="hint" title={t('offTitle')}>{t('offText')}</Notice> : null}
          <FormCard
            as="form"
            onSubmit={(e: React.FormEvent) => {
              e.preventDefault();
              if (!locked) void save();
            }}
          >
            <FormCardBody>
              <Section title={t('sender')}>
                <FormGrid>
                  <FixedValue id="mail-connection" testId="mail-connection" label={t('connection')} value={connection} reason={t('connectionReason')} size="full" />
                  <FormField id="mail-from" label={t('fromAddress')} required error={errors.fromAddress}>
                    <Input id="mail-from" type="email" value={form.fromAddress} disabled={locked} onChange={(e) => setForm({ ...form, fromAddress: e.target.value })} />
                  </FormField>
                  <FormField id="mail-from-name" label={t('fromName')} required error={errors.fromName}>
                    <Input id="mail-from-name" value={form.fromName} disabled={locked} onChange={(e) => setForm({ ...form, fromName: e.target.value })} />
                  </FormField>
                  <FormField id="mail-reply-to" label={t('replyTo')} hint={t('replyToHint')} error={errors.replyTo}>
                    <Input id="mail-reply-to" type="email" value={form.replyTo} placeholder={t('replyToPlaceholder')} disabled={locked} onChange={(e) => setForm({ ...form, replyTo: e.target.value })} />
                  </FormField>
                  <FormField id="mail-rate" label={t('rate')} hint={t('rateHint')} error={errors.ratePerMinute} size="s">
                    <Input id="mail-rate" type="number" min={1} max={120} value={String(form.ratePerMinute)} disabled={locked} onChange={(e) => setForm({ ...form, ratePerMinute: Number(e.target.value) })} />
                  </FormField>
                </FormGrid>
              </Section>
            </FormCardBody>
            {locked ? null : (
              <FormActionBar
                onSave={() => void save()}
                pending={pending}
                count={changed}
                onDiscard={() => setForm(values)}
                state={saveFb.state}
                testId="mail-settings-footer"
              />
            )}
          </FormCard>
        </div>
      </Section>

      <Section title={t('bodies')} intro={t('bodiesIntro')}>
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="title">{t('columns.type')}</TableHead>
                <TableHead col="meta">{t('columns.snippet')}</TableHead>
                {canManageSettings ? <TableHead col="actions"><span className="sr-only">{t('columns.actions')}</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((type) => (
                <TableRow key={type.key} data-testid="mail-body-row">
                  <TableCell col="title">{type.label}</TableCell>
                  <TableCell col="meta" wrap className="text-ink-2">{snippetName(byType[type.key]) ?? defaultLabel}</TableCell>
                  {canManageSettings ? (
                    <TableCell col="actions" className="text-right">
                      <RowMenu name={type.label} items={[{ key: 'choose', label: t('choose'), onSelect: () => setChoosing(type) }]} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      {choosing ? (
        <ChooseSnippetDialog type={choosing} snippets={snippets} current={byType[choosing.key] ?? ''} defaultLabel={defaultLabel} onClose={() => setChoosing(null)} />
      ) : null}
    </div>
  );
}

function ChooseSnippetDialog({ type, snippets, current, defaultLabel, onClose }: { type: { key: string; label: string }; snippets: { id: string; name: string }[]; current: string; defaultLabel: string; onClose: () => void }) {
  const t = useTranslations('dms.admin.mail');
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const submit = async () => {
    setPending(true);
    const result = await feedback.run(() => setMailBodySnippetAction(type.key, value || null), { retry: () => void submit() });
    setPending(false);
    if (result.status !== 'success') return;
    onClose();
    router.refresh();
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('chooseTitle')}</DialogTitle>
          <DialogDescription>{t('chooseText', { type: type.label })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="mail-body-snippet" label={t('snippet')}>
              <Select id="mail-body-snippet" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">{defaultLabel}</option>
                {snippets.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </FormField>
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" mode="run" cancel={onClose} onSave={() => void submit()} pending={pending} state={feedback.state} />
      </DialogContent>
    </Dialog>
  );
}

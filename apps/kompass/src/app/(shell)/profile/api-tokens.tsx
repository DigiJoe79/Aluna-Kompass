'use client';

import type { ApiTokenSummary } from '@kompass/core';
import { Copy } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { createTokenAction, revokeTokenAction } from './actions';

export function ApiTokens({ tokens }: { tokens: ApiTokenSummary[] }) {
  const t = useTranslations('profile.tokens');
  const c = useTranslations('common');
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createTokenAction, idleState);
  const [created, setCreated] = useState<{ token: string; record: ApiTokenSummary } | null>(null);
  const [revoke, setRevoke] = useState<ApiTokenSummary | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state.status === 'success' && state.data) {
      setCreated(state.data as { token: string; record: ApiTokenSummary });
      setOpen(false);
    }
  }, [state]);

  const daysSince = (iso: string | null) =>
    iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-heading text-[17px]">{t('title')}</h3>
          <p className="mt-1 text-[13px] text-ink-2">{t('intro')}</p>
        </div>
        <Button onClick={() => setOpen(true)}>{t('create')}</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="bg-surface shadow-md">
            <form action={action} className="flex flex-col gap-4">
              <DialogTitle className="font-heading text-[19px]">{t('createTitle')}</DialogTitle>
              {state.status === 'error' ? (
                <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">
                  {state.message}
                </p>
              ) : null}
              <FormField id="token-name" label={t('name')} hint={t('nameHint')}>
                <Input id="token-name" name="name" required />
              </FormField>
              <DialogFooter>
                <SubmitButton>{t('createSubmit')}</SubmitButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <table className="w-full text-[14px]">
        <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
          <tr className="h-9">
            <th className="px-3">{t('columns.name')}</th>
            <th className="px-3">{t('columns.created')}</th>
            <th className="px-3">{t('columns.lastUsed')}</th>
            <th className="px-3" />
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => {
            const days = daysSince(token.lastUsedAt);
            return (
              <tr key={token.id} className="h-[52px] border-b border-line-2">
                <td className={cn('px-3', token.revokedAt && 'text-disabled-ink')}>
                  <div className="font-semibold">{token.name}</div>
                  <div className="font-mono text-[11px] text-muted-ink">{token.prefix}…</div>
                </td>
                <td className="px-3 font-mono text-[12px]">
                  {format.dateTime(new Date(token.createdAt), { dateStyle: 'short' })}
                </td>
                <td
                  className={cn(
                    'px-3 font-mono text-[12px]',
                    !token.revokedAt && (days === null || days > 90) && 'text-warning'
                  )}
                >
                  {token.revokedAt
                    ? t('revokedAt', { date: format.dateTime(new Date(token.revokedAt), { dateStyle: 'short' }) })
                    : days === null
                      ? t('neverUsed')
                      : t('lastUsedDays', { days })}
                </td>
                <td className="px-3 text-right">
                  {token.revokedAt ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-error text-error"
                      onClick={() => setRevoke(token)}
                    >
                      {t('revoke')}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[12px] text-muted-ink">{t('footnote')}</p>
      {created ? (
        <Dialog open onOpenChange={() => {}}>
          <DialogContent
            showCloseButton={false}
            onEscapeKeyDown={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            className="w-[520px] bg-surface shadow-md"
          >
            <DialogTitle className="font-heading text-[19px]">
              {t('createdTitle', { name: created.record.name })}
            </DialogTitle>
            <DialogDescription className="text-[14px] text-ink-2">{t('createdText')}</DialogDescription>
            <div className="flex items-center gap-2 rounded-md border border-line-strong bg-code p-3">
              <code data-testid="api-token-plaintext" className="flex-1 break-all font-mono text-[13px]">
                {created.token}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(created.token);
                  setCopied(true);
                }}
              >
                <Copy className="size-3.5" aria-hidden />
                {copied ? c('copied') : c('copy')}
              </Button>
            </div>
            <p className="rounded-md border border-info bg-info-bg p-3 text-[13px] text-ink-2">
              {t('createdInfo')}
            </p>
            <Button
              onClick={() => {
                setCreated(null);
                setCopied(false);
              }}
            >
              {t('createdDone')}
            </Button>
          </DialogContent>
        </Dialog>
      ) : null}
      {revoke ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setRevoke(null);
          }}
          title={t('revokeTitle', { name: revoke.name })}
          description={t('revokeText')}
          confirmLabel={t('revoke')}
          destructive
          action={() => revokeTokenAction(revoke.id)}
        />
      ) : null}
    </section>
  );
}

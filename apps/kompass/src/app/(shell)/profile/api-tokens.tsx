'use client';

import type { ApiTokenSummary } from '@kompass/core';
import { Copy } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { idleState } from '@/lib/actions';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';
import { createTokenAction, revokeTokenAction } from './actions';
import { ActionForm } from '@/components/forms/action-form';

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

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-semibold">{t('title')}</h3>
          <p className="mt-1 text-[13px] text-ink-2">{t('intro')}</p>
        </div>
        <Button onClick={() => setOpen(true)}>{t('create')}</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent size="sm" className="bg-surface shadow-md">
            <ActionForm action={action} state={state} className="flex flex-col gap-4">
              <DialogTitle className="font-heading text-[19px]">{t('createTitle')}</DialogTitle>
              <FormField id="token-name" label={t('name')} hint={t('nameHint')}>
                <Input id="token-name" name="name" required />
              </FormField>
              <FormActionBar placement="dialog" mode="create" cancel={() => setOpen(false)} saveLabel={t('createSubmit')} state={state} />
            </ActionForm>
          </DialogContent>
        </Dialog>
      </div>
      <Table className="w-full text-[14px]">
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.name')}</TableHead>
            <TableHead>{t('columns.created')}</TableHead>
            <TableHead>{t('columns.lastUsed')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((token) => {
            const days = token.daysSinceLastUsed;
            return (
              <TableRow key={token.id}>
                <TableCell className={cn(token.revokedAt && 'text-disabled-ink')}>
                  <div className="font-semibold">{token.name}</div>
                  <div className="font-mono text-[11px] text-muted-ink">{token.prefix}…</div>
                </TableCell>
                <TableCell className="font-mono text-[12px]">
                  {format.dateTime(new Date(token.createdAt), { dateStyle: 'short' })}
                </TableCell>
                <TableCell
                  className={cn(
                    'font-mono text-[12px]',
                    !token.revokedAt && (days === null || days > 90) && 'text-warning'
                  )}
                >
                  {token.revokedAt
                    ? t('revokedAt', { date: format.dateTime(new Date(token.revokedAt), { dateStyle: 'short' }) })
                    : days === null
                      ? t('neverUsed')
                      : t('lastUsedDays', { days })}
                </TableCell>
                <TableCell className="text-right">
                  {token.revokedAt ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRevoke(token)}
                    >
                      {t('revoke')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-[12px] text-muted-ink">{t('footnote')}</p>
      {created ? (
        <Dialog open onOpenChange={() => {}}>
          <DialogContent
            showCloseButton={false}
            onEscapeKeyDown={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            size="md"
            className="bg-surface shadow-md"
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
                  if (await copyToClipboard(created.token)) setCopied(true);
                  else toast.error(c('copyFailed'), { duration: Infinity, closeButton: true });
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

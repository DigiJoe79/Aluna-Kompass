'use client';

import type { ApiTokenSummary } from '@kompass/core';
import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Notice } from '@/components/notice';
import { useDateFormat } from '@/components/date-format-provider';
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
import { KeyLine } from '@/components/key-line';
import { Section } from '@/components/section';
import { RowMenu } from '@/components/row-menu';

export function ApiTokens({ tokens }: { tokens: ApiTokenSummary[] }) {
  const t = useTranslations('profile.tokens');
  const c = useTranslations('common');
  const fmt = useDateFormat();
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
    <section className="rounded-lg border border-line bg-surface p-5">
      <Section
        title={t('title')}
        intro={t('intro')}
        actions={
          <>
            {/* Runde 3, 186: Zwei unabhängige Karten, eine Hauptaktion je Seite — „Token erstellen“ ist sekundär. */}
            <Button variant="outline" onClick={() => setOpen(true)}>{t('create')}</Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent size="sm" className="bg-surface shadow-md">
                <ActionForm action={action} state={state} className="flex flex-col gap-4">
                  <DialogTitle>{t('createTitle')}</DialogTitle>
                  <FormField id="token-name" label={t('name')} hint={t('nameHint')}>
                    <Input id="token-name" name="name" required />
                  </FormField>
                  <FormActionBar placement="dialog" mode="create" cancel={() => setOpen(false)} saveLabel={t('createSubmit')} state={state} />
                </ActionForm>
              </DialogContent>
            </Dialog>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Table className="w-full text-body">
            <TableHeader>
              <TableRow>
                <TableHead col="title">{t('columns.name')}</TableHead>
                <TableHead col="meta">{t('columns.created')}</TableHead>
                <TableHead col="meta">{t('columns.lastUsed')}</TableHead>
                <TableHead col="actions" className="w-11"><span className="sr-only">{c('rowActionsColumn')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => {
                const days = token.daysSinceLastUsed;
                return (
                  <TableRow key={token.id}>
                    <TableCell col="title" className={cn(token.revokedAt && 'text-disabled-ink')}>
                      <div className="font-semibold">{token.name}</div>
                      <KeyLine>{token.prefix}…</KeyLine>
                    </TableCell>
                    <TableCell col="meta" className="tabular-nums text-hint">
                      {fmt.date(token.createdAt)}
                    </TableCell>
                    <TableCell col="meta"
                      className={cn(
                        'tabular-nums text-hint',
                        // Runde 3, 186: Ein nie genutzter Token ist keine Arbeit (gedämpft); lange nicht genutzt bleibt ocker.
                        !token.revokedAt && days !== null && days > 90 ? 'text-warning' : !token.revokedAt && days === null ? 'text-muted-ink' : undefined
                      )}
                    >
                      {token.revokedAt
                        ? t('revokedAt', { date: fmt.date(token.revokedAt) })
                        : days === null
                          ? t('neverUsed')
                          : t('lastUsedDays', { days })}
                    </TableCell>
                    <TableCell col="actions" className="text-right">
                      <RowMenu name={token.name} items={[{ key: 'revoke', label: t('revoke'), kind: 'delete', hidden: !!token.revokedAt, onSelect: () => setRevoke(token) }]} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-hint text-muted-ink">{t('footnote')}</p>
          {created ? (
            <Dialog open onOpenChange={() => {}}>
              <DialogContent
                showCloseButton={false}
                onEscapeKeyDown={(e) => e.preventDefault()}
                onPointerDownOutside={(e) => e.preventDefault()}
                size="md"
                className="bg-surface shadow-md"
              >
                <DialogTitle>
                  {t('createdTitle', { name: created.record.name })}
                </DialogTitle>
                <DialogDescription tone="body">{t('createdText')}</DialogDescription>
                <div className="flex items-center gap-2 rounded-md border border-line-strong bg-code p-3">
                  <code data-testid="api-token-plaintext" className="flex-1 break-all font-mono text-meta">
                    {created.token}
                  </code>
                  <Button
                    variant="outline"
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
                <Notice level="warn">{t('createdInfo')}</Notice>
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
        </div>
      </Section>
    </section>
  );
}

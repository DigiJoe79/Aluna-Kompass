'use client';

import { checkThemeContrast, THEME_TOKENS, type Theme } from '@kompass/core/themes';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { SaveBar } from '@/components/forms/save-bar';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { activateThemeAction, deleteThemeAction, duplicateThemeAction, saveThemeAction } from './actions';
import { ThemePreview } from './theme-preview';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ThemeEditor({ themes, activeKey }: { themes: Theme[]; activeKey: string }) {
  const t = useTranslations('themes');
  const [selectedKey, setSelectedKey] = useState(activeKey);
  const selected = themes.find((th) => th.key === selectedKey) ?? themes[0]!;
  const [draft, setDraft] = useState<Theme | null>(null);
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const [dup, setDup] = useState(false);
  const [del, setDel] = useState(false);
  const [saving, start] = useTransition();
  const [dupForm, setDupForm] = useState({ key: '', name: '' });

  const current = draft && draft.key === selected.key ? draft : selected;
  const readOnly = selected.key === 'default';
  const findings = useMemo(() => checkThemeContrast(current), [current]);
  const pendingCount = useMemo(
    () =>
      draft
        ? THEME_TOKENS.filter(
            (k) =>
              draft.tokens[k].light !== selected.tokens[k].light ||
              draft.tokens[k].dark !== selected.tokens[k].dark
          ).length + (draft.name !== selected.name ? 1 : 0)
        : 0,
    [draft, selected]
  );

  const setToken = (token: (typeof THEME_TOKENS)[number], m: 'light' | 'dark', value: string) =>
    setDraft((d) => {
      const base = d && d.key === selected.key ? d : selected;
      return {
        ...base,
        tokens: { ...base.tokens, [token]: { ...base.tokens[token], [m]: value } },
      };
    });

  const select = (key: string) => {
    setSelectedKey(key);
    setDraft(null);
  };
  const chips = (th: Theme) =>
    (['color-primary', 'color-accent', 'bg', 'ink'] as const).map((k) => (
      <span
        key={k}
        className="size-3.5 rounded-[3px] border border-line-strong"
        style={{ background: th.tokens[k].light }}
        aria-hidden
      />
    ));

  return (
    <div className="grid min-h-[640px] grid-cols-[220px_minmax(0,1fr)_400px] overflow-hidden rounded-lg border border-line bg-surface">
      <aside className="flex flex-col gap-2 border-r border-line p-3">
        <ul aria-label={t('listAria')} className="flex flex-col gap-0.5">
          {themes.map((th) => (
            <li key={th.key} aria-label={th.name}>
              <button
                type="button"
                onClick={() => select(th.key)}
                className={cn(
                  'flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left hover:bg-hover',
                  th.key === selected.key &&
                    'bg-selected text-selected-ink shadow-[inset_2px_0_0_var(--color-primary)]'
                )}
              >
                <span className="flex items-center gap-2 text-[14px] font-semibold">
                  {th.name}
                  {th.key === activeKey ? (
                    <StatusBadge tone="success">{t('active')}</StatusBadge>
                  ) : null}
                </span>
                <span className="flex gap-1">{chips(th)}</span>
                <span className="text-[11px] text-muted-ink">
                  {th.key === 'default' ? t('readOnly') : th.key}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-auto text-[11px] text-muted-ink">{t('deleteHint')}</p>
      </aside>
      <section className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <FormField id="theme-name" label={t('name')} className="w-64">
            <Input
              id="theme-name"
              value={current.name}
              disabled={readOnly}
              onChange={(e) => setDraft({ ...current, name: e.target.value })}
            />
          </FormField>
          <div className="ml-auto flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setDupForm({ key: '', name: '' });
                setDup(true);
              }}
            >
              {t('duplicate')}
            </Button>
            {readOnly || selected.key === activeKey ? null : (
              <Button
                variant="outline"
                className="border-error text-error"
                onClick={() => setDel(true)}
              >
                {t('delete')}
              </Button>
            )}
            {selected.key === activeKey ? null : (
              <Button
                onClick={() =>
                  start(async () => {
                    const s = await activateThemeAction(selected.key);
                    if (s.status === 'error') toast.error(s.message);
                    else toast.success(s.status === 'success' ? s.message ?? '' : '');
                  })
                }
              >
                {t('activate')}
              </Button>
            )}
          </div>
        </div>
        {findings.length > 0 ? (
          <div
            role="alert"
            className="m-5 mb-0 flex gap-2 rounded-md border border-warning bg-warning-bg p-3 text-[13px] text-ink-2"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div>
              <div className="font-semibold text-warning">
                {t('contrastTitle', { ratio: findings[0]!.ratio.toFixed(1).replace('.', ',') })}
              </div>
              <ul className="mt-1 list-disc pl-4">
                {findings.map((f) => (
                  <li key={`${f.fg}-${f.bg}-${f.mode}`}>
                    {t('contrastPair', {
                      fg: f.fg,
                      bg: f.bg,
                      mode: t(`mode.${f.mode}`),
                      ratio: f.ratio.toFixed(2).replace('.', ','),
                      minimum: f.minimum,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-[minmax(0,1fr)_128px_128px] gap-3 bg-table-head px-5 py-2.5 text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
            <span>{t('columns.token')}</span>
            <span>{t('mode.light')}</span>
            <span>{t('mode.dark')}</span>
          </div>
          {THEME_TOKENS.map((token) => (
            <div
              key={token}
              className="grid grid-cols-[minmax(0,1fr)_128px_128px] items-center gap-3 border-b border-line-2 px-5 py-2"
            >
              <div>
                <div className="font-mono text-[12px]">{token}</div>
                <div className="text-[11px] text-muted-ink">{t(`tokens.${token}`)}</div>
              </div>
              {(['light', 'dark'] as const).map((m) => {
                const value = current.tokens[token][m];
                const isHex = HEX.test(value);
                return (
                  <div
                    key={m}
                    className="flex items-center gap-1.5 rounded-sm border border-line-strong bg-field px-1.5 py-1"
                  >
                    {isHex ? (
                      <span
                        className="size-4 rounded-[3px] border border-line-strong"
                        style={{ background: value }}
                        aria-hidden
                      />
                    ) : null}
                    <input
                      aria-label={`${token} ${t(`mode.${m}`).toLowerCase()}`}
                      value={value}
                      disabled={readOnly}
                      onChange={(e) => setToken(token, m, e.target.value)}
                      className="w-full bg-transparent font-mono text-[11px] outline-none"
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="px-5 py-2 text-[11px] text-muted-ink">{t('noInheritance')}</p>
        {readOnly ? null : (
          <SaveBar
            pendingCount={pendingCount}
            saving={saving}
            onDiscard={() => setDraft(null)}
            saveLabel={t('save')}
            onSave={() =>
              start(async () => {
                const s = await saveThemeAction(current);
                if (s.status === 'error') toast.error(s.message);
                else {
                  toast.success(s.status === 'success' ? s.message ?? '' : '');
                  setDraft(null);
                }
              })
            }
          />
        )}
      </section>
      <aside className="flex flex-col gap-3 border-l border-line bg-surface-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">{t('preview.title')}</span>
          <div className="flex overflow-hidden rounded-md border border-line-strong text-[12px]">
            {(['light', 'dark'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'px-3 py-1',
                  mode === m ? 'bg-brand text-on-brand' : 'bg-surface text-ink-2'
                )}
              >
                {t(`mode.${m}`)}
              </button>
            ))}
          </div>
        </div>
        <ThemePreview theme={current} mode={mode} />
      </aside>

      <Dialog open={dup} onOpenChange={setDup}>
        <DialogContent className="bg-surface shadow-md">
          <DialogTitle className="font-heading text-[19px]">
            {t('duplicateTitle', { name: selected.name })}
          </DialogTitle>
          <FormField id="dup-key" label={t('key')} hint={t('keyHint')}>
            <Input
              id="dup-key"
              value={dupForm.key}
              onChange={(e) => setDupForm({ ...dupForm, key: e.target.value })}
            />
          </FormField>
          <FormField id="dup-name" label={t('name')}>
            <Input
              id="dup-name"
              value={dupForm.name}
              onChange={(e) => setDupForm({ ...dupForm, name: e.target.value })}
            />
          </FormField>
          <DialogFooter>
            <Button
              disabled={saving}
              onClick={() =>
                start(async () => {
                  const s = await duplicateThemeAction({ sourceKey: selected.key, ...dupForm });
                  if (s.status === 'error') toast.error(s.message);
                  else {
                    setDup(false);
                    select(dupForm.key);
                  }
                })
              }
            >
              {t('duplicate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={t('deleteTitle', { name: selected.name })}
        description={t('deleteText')}
        confirmLabel={t('delete')}
        destructive
        action={async () => {
          const s = await deleteThemeAction(selected.key);
          if (s.status === 'success') select('default');
          return s;
        }}
      />
    </div>
  );
}

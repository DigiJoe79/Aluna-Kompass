'use client';

import { checkThemeContrast, THEME_TOKENS, type Theme } from '@kompass/core/themes';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, useTransition } from 'react';
import { Notice } from '@/components/notice';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { FormCard } from '@/components/forms/form-card';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { isRefusal } from '@/lib/actions';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { StatusBadge } from '@/components/status-badge';
import { Segmented } from '@/components/ui/segmented';
import { RecordActions } from '@/components/record-actions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { activateThemeAction, deleteThemeAction, duplicateThemeAction, saveThemeAction } from './actions';
import { ThemePreview } from './theme-preview';
import { Overline } from '@/components/overline';
import { ChevronRight } from 'lucide-react';
import { themeDisplayName } from '@/lib/theme-name';
import { THEME_TOKEN_GROUPS } from './token-groups';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ThemeEditor({ themes, activeKey }: { themes: Theme[]; activeKey: string }) {
  const t = useTranslations('themes');
  const [selectedKey, setSelectedKey] = useState(activeKey);
  const selected = themes.find((th) => th.key === selectedKey) ?? themes[0]!;
  const [draft, setDraft] = useState<Theme | null>(null);
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  // Runde 3, 179: Gruppen zu wie im Rolleneditor; offen bleibt nur die erste (Marke), der Rest auf Klick.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set([THEME_TOKEN_GROUPS[0]!.key]));
  const allOpen = THEME_TOKEN_GROUPS.every((g) => openGroups.has(g.key));
  const nameOf = (th: Theme) => themeDisplayName(th, t('defaultName'));
  const [dup, setDup] = useState(false);
  const [del, setDel] = useState(false);
  const moreActions = useRef<HTMLButtonElement>(null);
  const [saving, start] = useTransition();
  const saveFb = useActionFeedback();
  const activateFb = useActionFeedback();
  const dupFb = useActionFeedback();
  const [dupForm, setDupForm] = useState({ key: '', name: '' });
  const dupFieldError = (field: string) => (dupFb.state.status === 'error' ? dupFb.state.fieldErrors[field] : undefined);

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

  const closeDup = () => {
    dupFb.reset();
    setDup(false);
  };

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
    <FormCard className="grid min-h-[640px] grid-cols-[220px_minmax(0,1fr)_400px]">
      <aside className="flex flex-col gap-2 border-r border-line p-3">
        <ul aria-label={t('listAria')} className="flex flex-col gap-0.5">
          {themes.map((th) => (
            <li key={th.key} aria-label={nameOf(th)}>
              <button
                type="button"
                onClick={() => select(th.key)}
                className={cn(
                  'flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left hover:bg-hover',
                  th.key === selected.key &&
                    'bg-selected text-selected-ink shadow-[inset_2px_0_0_var(--color-primary)]'
                )}
              >
                <span className="flex items-center gap-2 text-body font-semibold">
                  {nameOf(th)}
                  {th.key === activeKey ? (
                    <StatusBadge tone="success">{t('active')}</StatusBadge>
                  ) : null}
                </span>
                <span className="flex gap-1">{chips(th)}</span>
                <span className="text-hint text-muted-ink">
                  {th.key === 'default' ? t('readOnly') : th.key}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-auto text-hint text-muted-ink">{t('deleteHint')}</p>
      </aside>
      <section className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <FormField id="theme-name" label={t('name')} className="w-64">
            <Input
              id="theme-name"
              value={readOnly ? nameOf(current) : current.name}
              disabled={readOnly}
              onChange={(e) => setDraft({ ...current, name: e.target.value })}
            />
          </FormField>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDupForm({ key: '', name: '' });
                setDup(true);
              }}
            >
              {t('duplicate')}
            </Button>
            {selected.key === activeKey ? null : (
              <Button
                onClick={() =>
                  start(async () => {
                    await activateFb.run(() => activateThemeAction(selected.key));
                  })
                }
              >
                {t('activate')}
              </Button>
            )}
            {/* Ausgeblendet beim aktiven und beim Default-Theme: Der Grund steht dauerhaft in der Seitenleiste (`deleteHint`). */}
            <RecordActions
              triggerRef={moreActions}
              actions={[{ key: 'delete', label: t('deleteItem'), kind: 'delete', onSelect: () => setDel(true), hidden: readOnly || selected.key === activeKey }]}
            />
          </div>
        </div>
        {isRefusal(activateFb.state) ? (
          <div className="border-b border-line px-5 py-3">
            <RefusalNotice action state={activateFb.state} />
          </div>
        ) : null}
        {findings.length > 0 ? (
          <div className="m-5 mb-0">
            <Notice level="warn" title={t('contrastTitle', { ratio: findings[0]!.ratio.toFixed(1).replace('.', ',') })} testId="contrast-findings">
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
            </Notice>
          </div>
        ) : null}
        <div className="flex-1 overflow-auto">
          {/* Fläche und Polster am Rahmen, die Overline bleibt reine Schrift (Designer 2026-10-10 § 10.7). */}
          <div className="bg-table-head px-5 py-2.5">
            <Overline as="div" className="grid grid-cols-[minmax(0,1fr)_128px_128px] gap-3">
              <span>{t('columns.token')}</span>
              <span>{t('mode.light')}</span>
              <span>{t('mode.dark')}</span>
            </Overline>
          </div>
          {/* „Alle aufklappen“ bleibt in einer eigenen Zeile: In der Kopfzeile ist bei 1440 px kein Platz — die Spalte
              Token ist schmaler als „Token“ und der Knopf, und Hell/Dunkel müssen über den Feldern der Zeilen stehen
              (Runde 4, 179; Teil J, an Design zurück). */}
          <div className="flex justify-end border-b border-line px-5 py-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpenGroups(allOpen ? new Set() : new Set(THEME_TOKEN_GROUPS.map((g) => g.key)))}>
              {allOpen ? t('collapseAll') : t('expandAll')}
            </Button>
          </div>
          {THEME_TOKEN_GROUPS.map((group) => {
            const isOpen = openGroups.has(group.key);
            return (
              <div key={group.key}>
                <div className="border-b border-line bg-table-head px-5 py-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={isOpen}
                    aria-controls={`theme-group-${group.key}`}
                    onClick={() =>
                      setOpenGroups((open) => {
                        const next = new Set(open);
                        if (next.has(group.key)) next.delete(group.key);
                        else next.add(group.key);
                        return next;
                      })
                    }
                    className="w-full justify-start gap-3 px-1"
                  >
                    <ChevronRight className={cn('size-4 shrink-0 text-muted-ink transition-transform', isOpen && 'rotate-90')} aria-hidden />
                    <Overline as="span">{t(`groups.${group.key}`)}</Overline>
                    <span className="text-hint font-normal text-muted-ink">{t('groupCount', { count: group.tokens.length })}</span>
                  </Button>
                </div>
                <div id={`theme-group-${group.key}`} hidden={!isOpen}>
                  {isOpen ? group.tokens.map((token) => (
                  <div
                    key={token}
                    className="grid grid-cols-[minmax(0,1fr)_128px_128px] items-center gap-3 border-b border-line-2 px-5 py-2"
                  >
                    <div>
                      <div className="font-mono text-hint">{token}</div>
                      <div className="text-hint text-muted-ink">{t(`tokens.${token}`)}</div>
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
                            className="w-full bg-transparent font-mono text-key outline-none"
                          />
                        </div>
                      );
                    })}
                  </div>
                  )) : null}
                </div>
              </div>
            );
          })}
        </div>
        <p className="px-5 py-2 text-hint text-muted-ink">{t('noInheritance')}</p>
        {readOnly ? null : (
          <FormActionBar
            count={pendingCount}
            pending={saving}
            state={saveFb.state}
            onDiscard={() => {
              setDraft(null);
              saveFb.reset();
            }}
            saveLabel={t('save')}
            onSave={() =>
              start(async () => {
                const s = await saveFb.run(() => saveThemeAction(current));
                if (s.status === 'success') setDraft(null);
              })
            }
          />
        )}
      </section>
      <aside className="border-l border-line bg-surface-2 p-4">
        {/* Die Vorschau läuft mit, während man unten in den Gruppen ändert (Runde 3, 179). Layout, kein Test. */}
        <div className="sticky top-0 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-meta font-semibold">{t('preview.title')}</span>
          <Segmented
            aria-label={t('preview.modeGroup')}
            options={(['light', 'dark'] as const).map((m) => ({ value: m, label: t(`mode.${m}`) }))}
            value={mode}
            onValueChange={setMode}
          />
        </div>
        <ThemePreview theme={current} mode={mode} />
        </div>
      </aside>

      <Dialog open={dup} onOpenChange={(o) => (o ? setDup(true) : closeDup())}>
        <DialogContent size="sm" className="bg-surface shadow-md">
          <DialogTitle>
            {t('duplicateTitle', { name: nameOf(selected) })}
          </DialogTitle>
          <FormGrid>
            <FormField id="dup-key" label={t('key')} hint={t('keyHint')} error={dupFieldError('key')} size="s">
              <Input
                id="dup-key"
                value={dupForm.key}
                onChange={(e) => setDupForm({ ...dupForm, key: e.target.value })}
              />
            </FormField>
            <FormField id="dup-name" label={t('name')} error={dupFieldError('name')}>
              <Input
                id="dup-name"
                value={dupForm.name}
                onChange={(e) => setDupForm({ ...dupForm, name: e.target.value })}
              />
            </FormField>
          </FormGrid>
          <FormActionBar
            placement="dialog"
            mode="create"
            cancel={() => closeDup()}
            pending={saving}
            saveLabel={t('duplicate')}
            state={withUnplacedFieldErrors(dupFb.state, ['key', 'name'])}
            onSave={() =>
              start(async () => {
                const s = await dupFb.run(() => duplicateThemeAction({ sourceKey: selected.key, ...dupForm }));
                if (s.status === 'success') {
                  closeDup();
                  select(dupForm.key);
                }
              })
            }
          />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        finalFocus={moreActions}
        title={t('deleteTitle', { name: nameOf(selected) })}
        description={t('deleteText')}
        confirmLabel={t('delete')}
        destructive
        action={async () => {
          const s = await deleteThemeAction(selected.key);
          if (s.status === 'success') select('default');
          return s;
        }}
      />
    </FormCard>
  );
}

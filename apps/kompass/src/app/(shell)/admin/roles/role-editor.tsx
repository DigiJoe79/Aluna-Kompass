'use client';

import type { Role } from '@kompass/core';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SaveBar } from '@/components/forms/save-bar';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import type { PermissionGroup } from '@/lib/permission-groups';
import { cn } from '@/lib/utils';
import { createRoleAction, saveRoleAction } from './actions';

export function RoleEditor({ roles, groups, allPermissionKeys }: { roles: Role[]; groups: PermissionGroup[]; allPermissionKeys: string[] }) {
  const tRoot = useTranslations();
  const t = useTranslations('roles');
  const p = useTranslations('permissions');
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? '');
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0];
  const [draft, setDraft] = useState<{ name: string; description: string; keys: Set<string> } | null>(null);
  const [saving, start] = useTransition();
  const [createState, createAction] = useActionState(createRoleAction, idleState);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    setDraft(null);
  }, [selectedId, roles]);

  useEffect(() => {
    if (createState.status === 'success') setCreateOpen(false);
  }, [createState]);

  const pendingCount = useMemo(() => {
    if (!draft || !selected) return 0;
    let n = 0;
    if (draft.name !== selected.name) n += 1;
    if (draft.description !== selected.description) n += 1;
    for (const key of allPermissionKeys) if (draft.keys.has(key) !== selected.permissionKeys.includes(key)) n += 1;
    return n;
  }, [draft, selected, allPermissionKeys]);

  if (!selected) return null;
  const effectiveKeys = selected.isProtected ? new Set(allPermissionKeys) : draft?.keys ?? new Set(selected.permissionKeys);
  const name = draft?.name ?? selected.name;
  const description = draft?.description ?? selected.description;

  const edit = (patch: Partial<{ name: string; description: string; keys: Set<string> }>) =>
    setDraft((d) => ({
      name: d?.name ?? selected.name,
      description: d?.description ?? selected.description,
      keys: d?.keys ?? new Set(selected.permissionKeys),
      ...patch,
    }));

  const toggle = (key: string, on: boolean) => {
    const keys = new Set(effectiveKeys);
    if (on) keys.add(key);
    else keys.delete(key);
    edit({ keys });
  };

  return (
    <div className="grid min-h-[560px] grid-cols-[280px_minmax(0,1fr)] overflow-hidden rounded-lg border border-line bg-surface">
      <aside className="flex flex-col border-r border-line p-3">
        <ul aria-label={t('listAria')} className="flex flex-col gap-0.5">
          {roles.map((role) => (
            <li key={role.id} aria-label={role.name}>
              <button
                type="button"
                onClick={() => setSelectedId(role.id)}
                className={cn(
                  'flex w-full flex-col items-start rounded-md px-3 py-2.5 text-left hover:bg-hover',
                  role.id === selected.id && 'bg-selected text-selected-ink shadow-[inset_2px_0_0_var(--color-primary)]',
                )}
              >
                <span className="flex items-center gap-1.5 text-[14px] font-semibold">
                  {role.name}
                  {role.isProtected ? <Lock className="size-3" aria-hidden /> : null}
                </span>
                <span className="text-[12px] text-muted-ink">
                  {role.isProtected
                    ? t('meta.protected', { users: role.userCount })
                    : t('meta.normal', { permissions: role.permissionKeys.length, users: role.userCount })}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 px-3 text-[12px] text-muted-ink">{t('noDelete')}</p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button variant="outline" className="mt-auto border-dashed">{t('create.button')}</Button>} />
          <DialogContent className="bg-surface shadow-md">
            <form action={createAction} className="flex flex-col gap-4">
              <DialogTitle className="font-heading text-[19px]">{t('create.title')}</DialogTitle>
              {createState.status === 'error' ? (
                <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">
                  {createState.message}
                </p>
              ) : null}
              <FormField id="new-role-name" label={t('fields.name')}>
                <Input id="new-role-name" name="name" required />
              </FormField>
              <FormField id="new-role-description" label={t('fields.description')}>
                <Input id="new-role-description" name="description" />
              </FormField>
              <DialogFooter>
                <SubmitButton>{t('create.submit')}</SubmitButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </aside>
      <section className="flex min-w-0 flex-col">
        <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-4 border-b border-line px-6 pb-4 pt-5">
          <FormField id="role-name" label={t('fields.name')}>
            <Input
              id="role-name"
              value={name}
              disabled={selected.isProtected}
              onChange={(e) => edit({ name: e.target.value })}
            />
          </FormField>
          <FormField id="role-description" label={t('fields.description')}>
            <Input
              id="role-description"
              value={description}
              disabled={selected.isProtected}
              onChange={(e) => edit({ description: e.target.value })}
            />
          </FormField>
        </div>
        <div className="flex-1 overflow-auto">
          {groups.map((group) => {
            const active = group.keys.filter((k) => effectiveKeys.has(k)).length;
            const state = active === 0 ? 'none' : active === group.keys.length ? 'all' : 'some';
            return (
              <div key={group.key}>
                <div className="flex items-center gap-3 border-b border-line bg-table-head px-6 py-2.5">
                  <Checkbox
                    aria-label={tRoot(group.labelKey)}
                    checked={state === 'all'}
                    indeterminate={state === 'some'}
                    disabled={selected.isProtected}
                    onCheckedChange={(c) => {
                      const keys = new Set(effectiveKeys);
                      for (const k of group.keys) {
                        if (c === true) keys.add(k);
                        else keys.delete(k);
                      }
                      edit({ keys });
                    }}
                  />
                  <span className="text-[12px] font-bold uppercase tracking-[.08em] text-ink-2">
                    {tRoot(group.labelKey)}
                  </span>
                  <span className="text-[12px] text-muted-ink">
                    {t('groupCount', { active, total: group.keys.length })}
                  </span>
                </div>
                {group.keys.map((key) => (
                  <label
                    key={key}
                    className="grid cursor-pointer grid-cols-[26px_260px_minmax(0,1fr)] items-center gap-3 border-b border-line-2 px-6 py-2.5 hover:bg-row-hover"
                  >
                    <Checkbox
                      aria-label={p(`keys.${key}.label`)}
                      checked={effectiveKeys.has(key)}
                      disabled={selected.isProtected}
                      onCheckedChange={(c) => toggle(key, c === true)}
                    />
                    <span>
                      <span className="block text-[14px] font-semibold">{p(`keys.${key}.label`)}</span>
                      <span className="block font-mono text-[11px] text-muted-ink">{key}</span>
                    </span>
                    <span className="text-[13px] text-ink-2">{p(`keys.${key}.description`)}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        {selected.isProtected ? null : (
          <SaveBar
            pendingCount={pendingCount}
            saving={saving}
            onDiscard={() => setDraft(null)}
            saveLabel={t('save')}
            onSave={() =>
              start(async () => {
                const s = await saveRoleAction({ id: selected.id, name, description, permissionKeys: [...effectiveKeys] });
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
    </div>
  );
}

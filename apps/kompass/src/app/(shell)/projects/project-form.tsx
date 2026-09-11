'use client';

import type { ProjectRecord } from '@kompass/core';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { LocalizedField } from '@/components/forms/localized-field';
import { MediaPicker } from '@/components/forms/media-picker';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormErrorSummary, TabInvalidDot } from '@/components/forms/form-error-summary';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { idleState } from '@/lib/actions';
import { saveProjectAction } from './actions';
import { Select } from '@/components/ui/select';

export function ProjectForm({ project, locales }: { project: ProjectRecord | null; locales: string[] }) {
  const t = useTranslations('projects.form');
  const c = useTranslations('content');
  const tCommon = useTranslations('common');
  const [state, action] = useActionState(saveProjectAction, idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => { if (state.status === 'success') toast.success(state.message ?? ''); else if (state.status === 'error' && Object.keys(errors).length === 0) toast.error(state.message); }, [state, errors]);
  return (
    <form action={action} className="overflow-hidden rounded-lg border border-line bg-surface">
      {project ? <input type="hidden" name="id" value={project.id} /> : null}
      <FormErrorSummary errors={errors} />
      <Tabs defaultValue="public">
        <TabsList className="border-b border-line bg-surface px-6"><TabsTrigger value="public" className="gap-2">{t('tabs.public')}{Object.keys(errors).length > 0 ? <TabInvalidDot label={tCommon('tabInvalid')} /> : null}</TabsTrigger><TabsTrigger value="finance" disabled>{t('tabs.finance')}</TabsTrigger></TabsList>
        <TabsContent value="public" className="grid gap-5 p-6 md:grid-cols-2">
          <FormField id="slug" label={c('slug')} hint={c('slugHint')} error={errors.slug}><Input id="slug" name="slug" defaultValue={project?.slug ?? ''} required pattern="[a-z0-9][a-z0-9-]{0,80}" className="font-mono" /></FormField>
          <FormField id="betterplaceProjectId" label={t('betterplace')} hint={t('betterplaceHint')} error={errors.betterplaceProjectId}><Input id="betterplaceProjectId" name="betterplaceProjectId" defaultValue={project?.betterplaceProjectId ?? ''} className="font-mono" /></FormField>
          <FormField id="type" label={t('type')}><Select id="type" name="type" defaultValue={project?.type ?? 'ongoing'} className="w-auto"><option value="ongoing">{t('types.ongoing')}</option><option value="shortTerm">{t('types.shortTerm')}</option></Select></FormField>
          <FormField id="status" label={t('status')}><Select id="status" name="status" defaultValue={project?.status ?? 'active'} className="w-auto"><option value="active">{t('statuses.active')}</option><option value="completed">{t('statuses.completed')}</option></Select></FormField>
          <LocalizedField name="name" label={t('name')} value={project?.name ?? {}} required errors={errors} locales={locales} />
          <LocalizedField name="summary" label={t('summary')} kind="textarea" rows={3} value={project?.summary ?? {}} errors={errors} locales={locales} />
          <LocalizedField name="body" label={t('body')} kind="markdown" rows={12} value={project?.body ?? {}} errors={errors} locales={locales} />
          <div className="md:col-span-2"><MediaPicker name="imageAssetId" value={project?.imageAssetId ?? null} label={t('image')} /></div>
          <div className="md:col-span-2"><FormActionBar back={{ href: '/projects', label: tCommon('backToList') }} /></div>
        </TabsContent>
        <TabsContent value="finance" className="p-6 text-[13px] text-muted-ink">{t('financeLater')}</TabsContent>
      </Tabs>
      <p className="border-t border-line bg-surface-2 px-6 py-2 text-[12px] text-muted-ink">{t('financeLater')}</p>
    </form>
  );
}

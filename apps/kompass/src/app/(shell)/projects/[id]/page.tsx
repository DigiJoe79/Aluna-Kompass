import { requirePermission } from '@kompass/core';
import { getProject } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { PendingPublishLine } from '@/components/site/pending-publish';
import { RelatedDocuments } from '@/components/related-documents';
import { ProjectForm } from '../project-form';
import { ProjectActions } from '../project-actions';
import { ProjectFinanceSection } from './finance-section';

export default async function ProjectEditPage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'projects.view')) return <Page width="standard"><ForbiddenCard permission="projects.view" /></Page>;
  const { id } = await props.params;
  const t = await getTranslations('projects');
  const locales = deps.locales();
  const leading = locales[0] ?? 'de';
  const c = await getTranslations('common');
  const back = { href: '/projects', label: c('backToList') };
  if (id === 'new') return (<Page width="standard" header={<PageHeader title={t('create')} back={back} />}><ProjectForm project={null} locales={locales} /></Page>);
  const project = await getProject(deps, ctx, id);
  if (!project.ok) notFound();
  const name = project.value.name[leading] || project.value.slug;
  const actions = requirePermission(ctx, 'projects.manage') ? undefined : <ProjectActions id={project.value.id} name={name} />;
  return (
    <Page width="standard" header={<PageHeader title={name} description={`/projekte/${project.value.slug}/`} back={back} actions={actions} />}>
      <PendingPublishLine href={`/projects/${project.value.id}`} className="-mt-3 mb-4 block" />
      <ProjectForm project={project.value} locales={locales} />
      <div className="mt-6 space-y-4">
        <ProjectFinanceSection deps={deps} ctx={ctx} projectId={project.value.id} />
        <RelatedDocuments deps={deps} ctx={ctx} entityType="project" entityId={project.value.id} />
      </div>
    </Page>
  );
}

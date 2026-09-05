import { getProject, requirePermission } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { ProjectForm } from '../project-form';

export default async function ProjectEditPage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'website.view')) return <ForbiddenCard permission="website.view" />;
  const { id } = await props.params;
  const t = await getTranslations('website.projects');
  if (id === 'new') return (<><PageHeader title={t('create')} /><ProjectForm project={null} /></>);
  const project = await getProject(deps, ctx, id);
  if (!project.ok) notFound();
  return (<><PageHeader title={project.value.name.de || project.value.slug} description={`/projekte/${project.value.slug}/`} /><ProjectForm project={project.value} /></>);
}

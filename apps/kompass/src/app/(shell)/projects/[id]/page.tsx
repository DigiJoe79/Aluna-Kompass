import { requirePermission } from '@kompass/core';
import { getProject } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { RelatedDocuments } from '@/components/related-documents';
import { ProjectForm } from '../project-form';

export default async function ProjectEditPage(props: { params: Promise<{ id: string }> }) {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'projects.view')) return <ForbiddenCard permission="projects.view" />;
  const { id } = await props.params;
  const t = await getTranslations('projects');
  const locales = deps.locales();
  const leading = locales[0] ?? 'de';
  const c = await getTranslations('common');
  const back = { href: '/projects', label: c('backToList') };
  if (id === 'new') return (<><PageHeader title={t('create')} back={back} /><ProjectForm project={null} locales={locales} /></>);
  const project = await getProject(deps, ctx, id);
  if (!project.ok) notFound();
  return (
    <>
      <PageHeader title={project.value.name[leading] || project.value.slug} description={`/projekte/${project.value.slug}/`} back={back} />
      <ProjectForm project={project.value} locales={locales} />
      <div className="mt-6">
        <RelatedDocuments deps={deps} ctx={ctx} entityType="project" entityId={project.value.id} />
      </div>
    </>
  );
}

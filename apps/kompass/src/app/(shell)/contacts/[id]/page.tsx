import { hasPermission, readSetting, requirePermission } from '@kompass/core';
import { contactRetention, contactRoleDefinitions, displayName, formatPostalAddress, getContact } from '@kompass/module-contacts';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { requireSession } from '@/lib/request-context';
import { ChannelsEditor } from './channels-editor';
import { RetentionPanel } from './retention-panel';
import { RolesPanel } from './roles-panel';
import { RelatedDocuments } from '@/components/related-documents';

export default async function ContactDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'contacts.view')) return <ForbiddenCard permission="contacts.view" />;

  const t = await getTranslations('contacts');
  const c = await getTranslations('common');

  const contactResult = await getContact(deps, ctx, id);
  if (!contactResult.ok) notFound();
  const contact = contactResult.value;

  const retentionResult = await contactRetention(deps, ctx, id);
  if (!retentionResult.ok) return <ForbiddenCard permission="contacts.view" />;
  const retention = retentionResult.value;

  const organizationCountry = (await readSetting<string>(deps, 'organization.country')) ?? undefined;
  const roleDefs = [...contactRoleDefinitions(deps).values()].map((d) => ({ key: d.key, retention: d.retention }));
  const canManage = hasPermission(ctx, 'contacts.manage');

  return (
    <>
      <PageHeader
        title={displayName(contact)}
        description={contact.kind === 'organization' ? t('fields.organization') : t('fields.person')}
        back={{ href: '/contacts', label: c('backToList') }}
        actions={
          contact.status === 'archived' ? (
            <StatusBadge tone="neutral">{t('archived')}</StatusBadge>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-line bg-surface p-5">
          <h2 className="mb-2 text-[13px] font-semibold text-muted-ink">{t('preview')}</h2>
          <pre
            data-testid="postal-address"
            className="whitespace-pre-line rounded-md border border-line bg-code-bg px-3 py-2 font-body text-[14px] leading-relaxed text-ink"
          >
            {formatPostalAddress(contact, contact.belongsTo, organizationCountry)}
          </pre>
          {contact.notes ? (
            <div className="mt-4 border-t border-line-2 pt-3">
              <span className="text-[12px] font-semibold text-muted-ink">{t('fields.notes')}</span>
              <p className="mt-1 text-[13px] text-ink-2">{contact.notes}</p>
            </div>
          ) : null}
        </section>

        <RetentionPanel
          contactId={contact.id}
          holds={retention.holds}
          roleKeysById={Object.fromEntries(contact.roles.map((r) => [r.id, r.role]))}
          until={retention.until}
          due={retention.due}
          canManage={canManage}
        />

        <RolesPanel
          contactId={contact.id}
          roles={contact.roles}
          roleDefinitions={roleDefs}
          canManage={canManage}
        />

        <ChannelsEditor
          contactId={contact.id}
          channels={contact.channels}
          canManage={canManage}
        />

        <RelatedDocuments deps={deps} ctx={ctx} entityType="contact" entityId={contact.id} />
      </div>
    </>
  );
}

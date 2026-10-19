import { hasPermission, isModuleEnabled, readLocales, readSetting, requirePermission, todayIn, userNamesFor } from '@kompass/core';
import { listContactIbans } from '@kompass/module-finance';
import { listMemberTypes, membershipForContact } from '@kompass/module-members';
import { dateFormatOf } from '@/lib/date-format';
import { nameOrEmpty } from '@/lib/name-or-empty';
import { statusTone } from '@/components/status-badge';
import { contactRetention, contactRoleDefinitions, displayName, formatPostalAddress, getContact } from '@kompass/module-contacts';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { requireSession } from '@/lib/request-context';
import { ChannelsEditor } from './channels-editor';
import { ContactActions } from './contact-actions';
import { RetentionPanel } from './retention-panel';
import { RolesPanel } from './roles-panel';
import { RelatedDocuments } from '@/components/related-documents';
import { CreateContactDialog } from '../contact-form';
import { Overline } from '@/components/overline';
import Link from 'next/link';
import { PeoplePanel } from './people-panel';
import { BankAccountsPanel, type BankAccountItem } from './bank-accounts-panel';

export default async function ContactDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'contacts.view')) return <Page width="standard"><ForbiddenCard permission="contacts.view" /></Page>;

  const t = await getTranslations('contacts');
  const c = await getTranslations('common');
  const nav = await getTranslations('nav');

  const contactResult = await getContact(deps, ctx, id);
  if (!contactResult.ok) notFound();
  const contact = contactResult.value;

  const retentionResult = await contactRetention(deps, ctx, id);
  if (!retentionResult.ok) return <Page width="standard"><ForbiddenCard permission="contacts.view" /></Page>;
  const retention = retentionResult.value;

  const organizationCountry = (await readSetting<string>(deps, 'organization.country')) ?? undefined;
  const roleDefs = [...contactRoleDefinitions(deps).values()].map((d) => ({ key: d.key, retention: d.retention, managed: d.managedBy !== undefined }));
  const canManage = hasPermission(ctx, 'contacts.manage');

  // Mitgliedschaft als Zeile in „Rollen“ (Handoff Mitglieder D4): nur mit Modul und Recht; ohne Mitgliedschaft keine Zeile.
  const membersOn = isModuleEnabled(deps, 'members') && hasPermission(ctx, 'members.read');
  const membershipRes = membersOn ? await membershipForContact(deps, ctx, contact.id) : null;
  const membership = membershipRes?.ok ? membershipRes.value : null;
  const running = membership && (membership.status === 'applied' || membership.status === 'active' || membership.status === 'ending') ? membership : null;
  let membershipRow: { href: string; summary: string; badge: { tone: 'info' | 'warning'; label: string } | null } | null = null;
  if (running) {
    const tm = await getTranslations('members');
    const types = await listMemberTypes(deps, ctx, { includeInactive: true });
    const type = types.ok ? types.value.find((ty) => ty.id === running.typeId) : undefined;
    const typeName = type ? nameOrEmpty(type.name[readLocales(deps)[0] ?? 'de'], type.key) : '';
    const fmt = dateFormatOf(deps);
    membershipRow = {
      href: `/members/${running.id}`,
      summary: running.memberNumber && running.joinedOn ? t('roles.memberSummary', { number: running.memberNumber, type: typeName, date: fmt.date(running.joinedOn) }) : t('roles.applicationSummary', { type: typeName, date: running.appliedOn ? fmt.date(running.appliedOn) : '' }),
      badge:
        running.status === 'applied'
          ? { tone: statusTone('membership', 'applied') as 'info', label: tm('detail.status.applied') }
          : running.status === 'ending' && running.endsOn
            ? { tone: statusTone('membership', 'ending') as 'warning', label: tm('detail.endsOn', { date: fmt.date(running.endsOn) }) }
            : null,
    };
  }

  // Bankverbindungen (Nachtrag MCP-Test § 3, Plan U4 Task 3): nur mit dem Modul Finanzen und `finance.read`.
  let bankAccounts: BankAccountItem[] | null = null;
  if (isModuleEnabled(deps, 'finance') && hasPermission(ctx, 'finance.read')) {
    const listed = await listContactIbans(deps, ctx, { contactId: contact.id });
    if (listed.ok) {
      const names = userNamesFor(deps, listed.value.items.map((i) => i.createdByUserId));
      bankAccounts = listed.value.items.map((i) => ({ id: i.id, iban: i.iban, source: i.source, learnedFromEntryDate: i.learnedFromEntryDate, createdAt: i.createdAt, createdByName: names.get(i.createdByUserId) ?? null, coHolders: i.coHolders }));
    }
  }

  const usesOrgAddress = contact.kind === 'person' && contact.belongsTo !== null && !(contact.street || contact.postalCode || contact.city);

  return (
    <Page
      width="standard"
      header={
        <PageHeader
          title={displayName(contact)}
          description={
            // „Person bei {Organisation}“ mit Link statt nur „Person“ (Nachtrag Ansprechpersonen § 3, 23d).
            contact.kind === 'person' && contact.belongsTo
              ? t.rich('personAt', { org: displayName(contact.belongsTo), link: (chunks) => <Link href={`/contacts/${contact.belongsTo!.id}`} className="text-link underline-offset-2 hover:underline">{chunks}</Link> })
              : contact.kind === 'organization' ? t('fields.organization') : t('fields.person')
          }
          back={{ href: '/contacts', label: nav('contacts.list') }}
          status={contact.status === 'archived' ? <StatusBadge tone="neutral">{t('archived')}</StatusBadge> : undefined}
          actions={
            <>
              {canManage ? (
                <CreateContactDialog
                  contact={{
                    id: contact.id,
                    kind: contact.kind,
                    salutation: contact.salutation,
                    firstName: contact.firstName,
                    lastName: contact.lastName,
                    name: contact.name,
                    legalForm: contact.legalForm,
                    addressExtra: contact.addressExtra,
                    street: contact.street,
                    postalCode: contact.postalCode,
                    city: contact.city,
                    country: contact.country,
                    notes: contact.notes,
                    updatedAt: contact.updatedAt,
                    belongsTo: contact.belongsTo ? { id: contact.belongsTo.id, name: displayName(contact.belongsTo) } : null,
                    deliveryPreference: contact.deliveryPreference,
                    automaticDelivery: contact.delivery.automatic.channel === 'email' ? contact.delivery.automatic : { channel: 'post' },
                  }}
                />
              ) : null}
              {canManage ? <ContactActions contactId={contact.id} until={retention.until} due={retention.due} held={retention.holds.length > 0} canAdmit={membersOn && hasPermission(ctx, 'members.manage') && !running} /> : null}
            </>
          }
        />
      }
    >
      {/* Anschrift und Wege oben, Aufbewahrung zuletzt (04 B11). */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-label={t('preview')} className="rounded-md border border-line bg-surface p-5">
          <Overline className="mb-2">{t('preview')}</Overline>
          {/* Die Anschrift als Text, ohne Rahmen und Codefläche: keine Karte in der Karte (§ E, 04 B12). */}
          <p data-testid="postal-address" className="whitespace-pre-line text-body text-ink">
            {formatPostalAddress(contact, contact.belongsTo, organizationCountry)}
          </p>
          {/* Ohne eigene Anschrift gilt die der Organisation (Nachtrag Ansprechpersonen § 3, 23d). */}
          {usesOrgAddress ? <p className="mt-1 text-hint text-muted-ink">{t('address.ofOrg')}</p> : null}
          {/* Nur bei „Immer per Post“; bei „Automatisch“ steht nichts (Handoff 2b E1, 18b). */}
          {contact.deliveryPreference === 'post' ? (
            <div className="mt-3" data-testid="delivery-post-badge">
              <StatusBadge tone="neutral">{t('letters.badgePost')}</StatusBadge>
            </div>
          ) : null}
          {contact.notes ? (
            <div className="mt-4 border-t border-line-2 pt-3">
              <span className="text-hint font-semibold text-muted-ink">{t('fields.notes')}</span>
              <p className="mt-1 text-meta text-ink-2">{contact.notes}</p>
            </div>
          ) : null}
        </section>

        <ChannelsEditor
          contactId={contact.id}
          contactName={displayName(contact)}
          channels={contact.channels}
          canManage={canManage}
          extraAction={
            // Eine Ansprechperson ist ein Weg zur Organisation: ohne Personen steht „Person anlegen“ hier (23c).
            contact.kind === 'organization' && contact.people.length === 0 && canManage ? (
              <CreateContactDialog triggerLabel={t('people.create')} initialBelongsTo={{ id: contact.id, name: displayName(contact) }} />
            ) : undefined
          }
        />

        {contact.kind === 'organization' && contact.people.length > 0 ? (
          <PeoplePanel organization={{ id: contact.id, name: displayName(contact) }} people={contact.people} canManage={canManage} />
        ) : null}

        <RolesPanel
          contactId={contact.id}
          contactName={displayName(contact)}
          roles={contact.roles}
          roleDefinitions={roleDefs}
          canManage={canManage}
          today={todayIn(deps)}
          membership={membershipRow}
        />

        {bankAccounts ? <BankAccountsPanel contactId={contact.id} contactName={displayName(contact)} items={bankAccounts} canEdit={hasPermission(ctx, 'finance.entriesWrite')} /> : null}

        <RelatedDocuments deps={deps} ctx={ctx} entityType="contact" entityId={contact.id} />

        <RetentionPanel holds={retention.holds} roleKeysById={Object.fromEntries(contact.roles.map((r) => [r.id, r.role]))} />
      </div>
    </Page>
  );
}

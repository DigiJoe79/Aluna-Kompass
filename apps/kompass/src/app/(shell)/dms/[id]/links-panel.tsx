'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { linkDocumentAction, unlinkDocumentAction } from '../actions';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { Section } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { nameOrEmpty } from '@/lib/name-or-empty';

export interface ResolvedLink {
  id: string;
  entityType: string;
  entityId: string;
  role: string;
  label: string | null;
  href: string | null;
  reason: 'missing' | 'forbidden' | null;
}

const ROLES = ['sender', 'recipient', 'about'] as const;

/**
 * Die Bezüge des Dokuments zu Kontakten, Tieren und Projekten — sichtbar,
 * ergänzbar, lösbar. Wer nur lesen darf, sieht die Liste ohne Knöpfe.
 */
export function LinksPanel({
  documentId,
  links,
  canEdit,
  canCreateContact,
  animals,
  projects,
}: {
  documentId: string;
  links: ResolvedLink[];
  canEdit: boolean;
  canCreateContact: boolean;
  animals: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}) {
  const t = useTranslations('dms');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [entityType, setEntityType] = useState('contact');
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [otherId, setOtherId] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('about');
  const [pending, start] = useTransition();
  const addFb = useActionFeedback();
  // „Lösen“ steht in den Zeilen der Liste: Die Ablehnung steht über der Liste.
  const removeFb = useActionFeedback();

  const types = ['contact', ...(animals.length > 0 ? ['animal'] : []), ...(projects.length > 0 ? ['project'] : [])];
  const entityId = entityType === 'contact' ? (contact?.id ?? '') : otherId;

  const submit = () => {
    if (!entityId) return;
    start(async () => {
      const state = await addFb.run(() => linkDocumentAction(documentId, entityType, entityId, role), { retry: submit });
      if (state.status !== 'success') return;
      setOpen(false);
      setContact(null);
      setOtherId('');
      router.refresh();
    });
  };

  const remove = (linkId: string) =>
    start(async () => {
      const state = await removeFb.run(() => unlinkDocumentAction(documentId, linkId), { retry: () => remove(linkId) });
      if (state.status === 'success') router.refresh();
    });

  return (
    // Ohne eigene Karte: Bezüge und Dokumentbezüge stehen in einer Karte der Dokumentseite (03 B29).
    <Section title={t('linksTitle')}
        actions={
          <>
            {canEdit ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                {t('links.add')}
              </Button>
            ) : null}
          </>
        }
      >
        <RefusalNotice action state={removeFb.state} />

        {links.length === 0 ? (
          <p className="text-meta text-muted-ink">{t('links.none')}</p>
        ) : (
          <ul data-testid="document-links" className="space-y-2 text-meta text-ink-2">
            {links.map((link) => (
              // Die Rolle als Marke statt „— Empfänger (Kontakt)“ im Fließtext; die Art des Bezugs sagt der Name (03 B34).
              <li key={link.id} className="flex items-center gap-2">
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  {link.href && link.label ? (
                    <Link href={link.href} className="underline underline-offset-2">
                      {link.label}
                    </Link>
                  ) : (
                    <span className={link.label ? undefined : 'text-muted-ink'}>
                      {link.label ?? (link.reason === 'forbidden' ? t('linkForbidden') : t('linkMissing'))}
                    </span>
                  )}
                  {/* Nie der Schlüssel: Fehlt die Übersetzung, steht der Leerwert (MUSTER „Namen statt Schlüssel“). */}
                  <StatusBadge tone={statusTone('role', 'current')}>{nameOrEmpty(t.has(`roles.${link.role}`) ? t(`roles.${link.role}`) : null, link.role)}</StatusBadge>
                </span>
                {canEdit ? (
                  <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => remove(link.id)}>
                    {t('links.remove')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent size="md" className="bg-surface shadow-md">
            <DialogTitle>{t('links.addTitle')}</DialogTitle>
            <DialogDescription>{t('links.addDescription')}</DialogDescription>

            <div className="mt-5">
              <FormGrid>
                {types.length > 1 ? (
                  <FormField id="link-entity-type" label={t('links.entityType')} size="s">
                    <Select id="link-entity-type" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
                      {types.map((type) => (
                        <option key={type} value={type}>
                          {t(`entities.${type}`)}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                ) : null}

                {entityType === 'contact' ? (
                  <FormCell size="m">
                    <ContactPicker
                      id="link-contact"
                      name="linkContactId"
                      label={t('links.contact')}
                      value={contact}
                      onChange={setContact}
                      canCreate={canCreateContact}
                      required
                    />
                  </FormCell>
                ) : (
                  <FormField id="link-entity-id" label={t(`entities.${entityType}`)} required>
                    <Select id="link-entity-id" value={otherId} onChange={(e) => setOtherId(e.target.value)}>
                      <option value="">{t('links.choose')}</option>
                      {(entityType === 'animal' ? animals : projects).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                )}

                <FormField id="link-role" label={t('links.role')} required size="s">
                  <Select id="link-role" value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`)}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </FormGrid>
            </div>

            <FormActionBar placement="dialog" cancel={() => setOpen(false)} pending={pending} saveDisabled={!entityId} saveLabel={t('links.submit')} onSave={submit} state={addFb.state} note={<span className="text-hint text-muted-ink">{tCommon('requiredLegend')}</span>} />
          </DialogContent>
        </Dialog>
      </Section>
  );
}

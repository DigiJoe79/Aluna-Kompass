'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { linkDocumentAction, unlinkDocumentAction } from '../actions';

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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [entityType, setEntityType] = useState('contact');
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [otherId, setOtherId] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('about');
  const [pending, start] = useTransition();

  const types = ['contact', ...(animals.length > 0 ? ['animal'] : []), ...(projects.length > 0 ? ['project'] : [])];
  const entityId = entityType === 'contact' ? (contact?.id ?? '') : otherId;

  const submit = () => {
    if (!entityId) return;
    start(async () => {
      const state = await linkDocumentAction(documentId, entityType, entityId, role);
      if (state.status === 'error') {
        toast.error(state.message);
        return;
      }
      if (state.status === 'success' && state.message) toast.success(state.message);
      setOpen(false);
      setContact(null);
      setOtherId('');
      router.refresh();
    });
  };

  const remove = (linkId: string) =>
    start(async () => {
      const state = await unlinkDocumentAction(documentId, linkId);
      if (state.status === 'error') toast.error(state.message);
      else if (state.status === 'success' && state.message) toast.success(state.message);
      router.refresh();
    });

  return (
    <section className="rounded-md border border-line bg-surface p-5 shadow-xs">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-ink">{t('linksTitle')}</h3>
        {canEdit ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" aria-hidden />
            {t('links.add')}
          </Button>
        ) : null}
      </div>

      {links.length === 0 ? (
        <p className="text-[13px] text-muted-ink">{t('links.none')}</p>
      ) : (
        <ul data-testid="document-links" className="space-y-2 text-[13px] text-ink-2">
          {links.map((link) => (
            <li key={link.id} className="flex items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-full bg-muted-ink" aria-hidden />
              <span className="flex-1">
                {link.href && link.label ? (
                  <Link href={link.href} className="underline underline-offset-2">
                    {link.label}
                  </Link>
                ) : (
                  <span className={link.label ? undefined : 'text-muted-ink'}>
                    {link.label ?? (link.reason === 'forbidden' ? t('linkForbidden') : t('linkMissing'))}
                  </span>
                )}
                {' — '}
                {t.has(`roles.${link.role}`) ? t(`roles.${link.role}`) : link.role}
                {t.has(`entities.${link.entityType}`) ? ` (${t(`entities.${link.entityType}`)})` : null}
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
        <DialogContent className="w-full sm:max-w-[520px] bg-surface p-6 shadow-md">
          <DialogTitle className="font-heading text-[19px]">{t('links.addTitle')}</DialogTitle>
          <DialogDescription className="text-[13px] text-muted-ink">{t('links.addDescription')}</DialogDescription>

          <div className="mt-5 space-y-4">
            {types.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="link-entity-type">{t('links.entityType')}</Label>
                <Select id="link-entity-type" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
                  {types.map((type) => (
                    <option key={type} value={type}>
                      {t(`entities.${type}`)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}

            {entityType === 'contact' ? (
              <ContactPicker
                id="link-contact"
                name="linkContactId"
                label={t('links.contact')}
                value={contact}
                onChange={setContact}
                canCreate={canCreateContact}
                required
              />
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="link-entity-id" required>
                  {t(`entities.${entityType}`)}
                </Label>
                <Select id="link-entity-id" value={otherId} onChange={(e) => setOtherId(e.target.value)}>
                  <option value="">{t('links.choose')}</option>
                  {(entityType === 'animal' ? animals : projects).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="link-role" required>
                {t('links.role')}
              </Label>
              <Select id="link-role" value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('links.cancel')}
            </Button>
            <Button type="button" disabled={!entityId || pending} onClick={submit}>
              {t('links.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

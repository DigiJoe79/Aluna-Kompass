'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState, useTransition } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { idleState } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { createDocumentTypeAction, deleteDocumentTypeAction, updateDocumentTypeAction } from './actions';
import { Select } from '@/components/ui/select';
import { ActionForm } from '@/components/forms/action-form';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Checkbox } from '@/components/ui/checkbox';

export interface DocumentTypeItem {
  key: string;
  label: string;
  prefix: string;
  defaultDirection: 'incoming' | 'outgoing';
  retentionClass: string;
  defaultFolder: string | null;
  isActive: boolean;
  sortOrder: number;
  ownerModule?: string | null;
  protectionArea?: string | null;
  /** Wie viele Dokumente die Art hat; `null`, wenn der Aufrufer sie nicht zählen darf. */
  areaCount?: number | null;
  /** Task 4: ob `deleteDocumentType` bei dieser Art greifen würde — der Server prüft es vorab, damit der Knopf nichts verspricht, was scheitern würde. */
  deletable?: boolean;
}

/** Ein Schutzbereich, den ein Modul anmeldet — einfache Daten, kein Dienst (Client-Grenze). */
export interface AreaItem {
  key: string;
  permission: string;
  /** Ob der Aufrufer das Recht des Bereichs selbst hat. */
  held: boolean;
}

export function TypesPanel({
  types,
  folders,
  areas = [],
}: {
  types: DocumentTypeItem[];
  folders: string[];
  areas?: AreaItem[];
}) {
  const t = useTranslations('dms.admin');
  const tDms = useTranslations('dms');
  const tCommon = useTranslations('common');
  const tPerm = useTranslations('permissions.keys');
  // Das Label eines Bereichs bringt das Modul mit, das ihn anmeldet (`dms.areas.<key>`); ohne fällt es auf den Schlüssel zurück.
  const areaLabel = (key: string) => (tDms.has(`areas.${key}`) ? tDms(`areas.${key}`) : key);
  const permissionLabel = (permission: string) => (tPerm.has(`${permission}.label`) ? tPerm(`${permission}.label`) : permission);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingType, setEditingType] = useState<DocumentTypeItem | null>(null);
  // Der gewählte Bereich im Bearbeiten-Dialog — für den Hinweis vor dem Speichern.
  const [areaValue, setAreaValue] = useState('');
  const [typeToDelete, setTypeToDelete] = useState<DocumentTypeItem | null>(null);
  const [deletePending, startDeleteTransition] = useTransition();
  const deleteFb = useActionFeedback();

  const handleDelete = (key: string) => {
    startDeleteTransition(async () => {
      const res = await deleteFb.run(() => deleteDocumentTypeAction(key), { retry: () => handleDelete(key) });
      if (res.status === 'success') setTypeToDelete(null);
    });
  };

  const [createState, createAction] = useActionState(async (prev: any, formData: FormData) => {
    const res = await createDocumentTypeAction(prev, formData);
    if (res.status === 'success') setCreateOpen(false);
    return res;
  }, idleState);

  const [editState, editAction] = useActionState(async (prev: any, formData: FormData) => {
    if (!editingType) return prev;
    const res = await updateDocumentTypeAction(editingType.key, prev, formData);
    if (res.status === 'success') setEditingType(null);
    return res;
  }, idleState);

  /**
   * Die Auswahl „Schutzbereich“ im Bearbeiten-Dialog. Als Funktion, nicht als
   * eigene Komponente: Sonst würde der Dialog bei jedem Tastendruck neu
   * aufgebaut. Ohne angemeldeten Bereich (und ohne gesetzten) gibt es sie nicht.
   */
  const areaField = (type: DocumentTypeItem) => {
    const current = type.protectionArea ?? null;
    if (areas.length === 0 && current === null) return null;

    // Modul-eigene Arten: nur Anzeige, der Bereich ist fest.
    if (type.ownerModule) {
      return current ? (
        <p className="col-span-full text-[13px] text-muted-ink">
          {t('area')}: {areaLabel(current)}
        </p>
      ) : null;
    }

    const currentArea = current === null ? null : areas.find((area) => area.key === current);
    if (current !== null && !currentArea) {
      return <p className="col-span-full rounded-md bg-error-bg p-2.5 text-[13px] text-error">{t('areaUnknown', { key: current })}</p>;
    }

    // Ändern darf nur, wer das Recht des jetzigen Bereichs selbst hat; die anderen stehen ausgegraut in der Liste.
    const locked = currentArea ? !currentArea.held : false;
    const chosen = areas.find((area) => area.key === areaValue);
    const changed = areaValue !== (current ?? '');
    const count = type.areaCount ?? 0;
    return (
      <FormField id="edit-area" label={t('area')}>
        <Select id="edit-area" name="protectionArea" value={areaValue} onChange={(e) => setAreaValue(e.target.value)} disabled={locked}>
          <option value="">{t('areaNone')}</option>
          {areas.map((area) => (
            <option key={area.key} value={area.key} disabled={!area.held}>
              {areaLabel(area.key)}
            </option>
          ))}
        </Select>
        {locked && currentArea ? <p className="text-[12px] text-muted-ink">{t('areaNotHeld', { permission: permissionLabel(currentArea.permission) })}</p> : null}
        {!locked && changed ? (
          <div className="space-y-1 rounded-md bg-info-bg px-3 py-2.5 text-[12px] text-ink-2" data-testid="area-hint">
            <p>{chosen ? t('areaSetHint', { count, permission: permissionLabel(chosen.permission) }) : t('areaRemoveHint', { count })}</p>
            <p>{t('areaExceptions')}</p>
          </div>
        ) : null}
      </FormField>
    );
  };

  return (
    <section className="space-y-4 rounded-md border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] text-ink-2">{t('typesDescription')}</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          {t('createType')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('typeColumns.prefix')}</TableHead>
              <TableHead>{t('typeColumns.label')}</TableHead>
              <TableHead>{t('typeColumns.direction')}</TableHead>
              <TableHead>{t('typeColumns.retention')}</TableHead>
              <TableHead>{t('typeColumns.folder')}</TableHead>
              <TableHead>{t('typeColumns.status')}</TableHead>
              <TableHead className="text-right">{t('typeColumns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((row, i) => (
              <TableRow key={row.key}>
                <TableCell className="font-mono font-bold text-ink">{row.prefix}</TableCell>
                {/* Schlüssel als zweite Zeile unter der Bezeichnung: acht Spalten scrollten auf der standard-Seite waagerecht (K9-Befund 8). */}
                <TableCell>
                  <span className="font-medium text-ink">{row.label}</span>
                  <span className="block font-mono text-[12px] text-muted-ink">{row.key}</span>
                </TableCell>
                <TableCell className="text-ink-2">{tDms(`directions.${row.defaultDirection}`)}</TableCell>
                <TableCell className="text-ink-2">{t(`retentionClasses.${row.retentionClass}`)}</TableCell>
                <TableCell className="text-ink-2">{row.defaultFolder ?? '—'}</TableCell>
                <TableCell>
                  <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>
                    {row.isActive ? t('active') : t('inactive')}
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAreaValue(row.protectionArea ?? '');
                        setEditingType(row);
                      }}
                    >
                      {t('edit')}
                    </Button>
                    {row.deletable ? (
                      <Button variant="ghost" size="sm" onClick={() => setTypeToDelete(row)}>
                        {t('delete')}
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Dialog: Create Type */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent size="md" className="bg-surface shadow-md">
          <ActionForm action={createAction} state={createState} className="space-y-4">
            <DialogTitle className="font-heading text-[19px]">{t('createTypeTitle')}</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-ink">{t('createTypeDescription')}</DialogDescription>

            <section>
              <h3 className="text-[15px] font-semibold">{t('typeSections.identity')}</h3>
              <div className="mt-3">
                <FormGrid>
                  <FormField id="create-key" label={t('typeColumns.key')} size="s">
                    <Input id="create-key" name="key" placeholder={t('typeKeyPlaceholder')} required />
                  </FormField>
                  <FormField id="create-prefix" label={t('typeColumns.prefix')} size="s">
                    <Input id="create-prefix" name="prefix" placeholder={t('typeShortPlaceholder')} maxLength={3} required />
                  </FormField>
                  <FormField id="create-label" label={t('typeColumns.label')}>
                    <Input id="create-label" name="label" required />
                  </FormField>
                </FormGrid>
              </div>
            </section>
            <section className="border-t border-line pt-5">
              <h3 className="text-[15px] font-semibold">{t('typeSections.filing')}</h3>
              <div className="mt-3">
                <FormGrid>
                  <FormField id="create-direction" label={t('typeColumns.direction')} size="s">
                    <Select
                      id="create-direction"
                      name="defaultDirection"
                      defaultValue="incoming"
                    >
                      <option value="incoming">{tDms('directions.incoming')}</option>
                      <option value="outgoing">{tDms('directions.outgoing')}</option>
                    </Select>
                  </FormField>
                  <FormField id="create-retention" label={t('typeColumns.retention')}>
                    <Select
                      id="create-retention"
                      name="retentionClass"
                      defaultValue="statutory10Y"
                    >
                      <option value="statutory10Y">{t('retentionClasses.statutory10Y')}</option>
                      <option value="statutory8Y">{t('retentionClasses.statutory8Y')}</option>
                      <option value="statutory6Y">{t('retentionClasses.statutory6Y')}</option>
                      <option value="permanent">{t('retentionClasses.permanent')}</option>
                      <option value="consent">{t('retentionClasses.consent')}</option>
                    </Select>
                  </FormField>
                  <FormField id="create-folder" label={t('typeColumns.folder')}>
                    <Select
                      id="create-folder"
                      name="defaultFolder"
                      defaultValue=""
                    >
                      <option value="">{tDms('inbox')}</option>
                      {folders.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  {areas.length > 0 ? (
                    <FormField id="create-area" label={t('area')}>
                      <Select id="create-area" name="protectionArea" defaultValue="">
                        <option value="">{t('areaNone')}</option>
                        {areas.map((area) => (
                          <option key={area.key} value={area.key} disabled={!area.held}>
                            {areaLabel(area.key)}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  ) : null}
                </FormGrid>
              </div>
            </section>

            <FormActionBar placement="dialog" mode="create" cancel={() => setCreateOpen(false)} saveLabel={t('save')} state={createState} />
          </ActionForm>
        </DialogContent>
      </Dialog>

      {/* Dialog: Edit Type */}
      <Dialog open={Boolean(editingType)} onOpenChange={(open) => !open && setEditingType(null)}>
        <DialogContent size="md" className="bg-surface shadow-md">
          {editingType && (
            <ActionForm action={editAction} state={editState} className="space-y-4">
              <DialogTitle className="font-heading text-[19px]">{t('editTypeTitle')}</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-ink">{t('editTypeDescription')}</DialogDescription>

              <section>
                <h3 className="text-[15px] font-semibold">{t('typeSections.identity')}</h3>
                <div className="mt-3">
                  <FormGrid>
                    <FormField id="edit-key" label={t('typeColumns.key')} hint={t('typeImmutableHint')} size="s">
                      <Input id="edit-key" value={editingType.key} disabled />
                    </FormField>
                    <FormField id="edit-prefix" label={t('typeColumns.prefix')} hint={editingType.ownerModule ? undefined : t('prefixHint')} size="s">
                      {editingType.ownerModule ? (
                        <Input id="edit-prefix" value={editingType.prefix} disabled />
                      ) : (
                        <Input
                          id="edit-prefix"
                          name="prefix"
                          maxLength={3}
                          className="font-mono uppercase"
                          defaultValue={editingType.prefix}
                          required
                        />
                      )}
                    </FormField>
                    <FormField id="edit-label" label={t('typeColumns.label')}>
                      <Input id="edit-label" name="label" defaultValue={editingType.label} required />
                    </FormField>
                  </FormGrid>
                </div>
              </section>
              <section className="border-t border-line pt-5">
                <h3 className="text-[15px] font-semibold">{t('typeSections.filing')}</h3>
                {editingType.ownerModule ? (
                  <p className="mt-3 text-[13px] text-muted-ink">{t('ownedByModule', { module: editingType.ownerModule })}</p>
                ) : null}
                <div className="mt-3">
                  <FormGrid>
                    {editingType.ownerModule ? null : (
                      <>
                        <FormField id="edit-direction" label={t('typeColumns.direction')} size="s">
                          <Select
                            id="edit-direction"
                            name="defaultDirection"
                            defaultValue={editingType.defaultDirection}
                          >
                            <option value="incoming">{tDms('directions.incoming')}</option>
                            <option value="outgoing">{tDms('directions.outgoing')}</option>
                          </Select>
                        </FormField>
                        <FormField id="edit-retention" label={t('typeColumns.retention')}>
                          <Select
                            id="edit-retention"
                            name="retentionClass"
                            defaultValue={editingType.retentionClass}
                          >
                            <option value="statutory10Y">{t('retentionClasses.statutory10Y')}</option>
                            <option value="statutory8Y">{t('retentionClasses.statutory8Y')}</option>
                            <option value="statutory6Y">{t('retentionClasses.statutory6Y')}</option>
                            <option value="permanent">{t('retentionClasses.permanent')}</option>
                            <option value="consent">{t('retentionClasses.consent')}</option>
                          </Select>
                        </FormField>
                      </>
                    )}
                    <FormField id="edit-folder" label={t('typeColumns.folder')}>
                      <Select
                        id="edit-folder"
                        name="defaultFolder"
                        defaultValue={editingType.defaultFolder ?? ''}
                      >
                        <option value="">{tDms('inbox')}</option>
                        {folders.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    {areaField(editingType)}
                    {editingType.ownerModule ? null : (
                      <FormField id="edit-active" label={t('activeCheckbox')} toggle>
                        <Checkbox id="edit-active" name="isActive" defaultChecked={editingType.isActive} value="on" />
                      </FormField>
                    )}
                  </FormGrid>
                </div>
              </section>

              <FormActionBar placement="dialog" mode="create" cancel={() => setEditingType(null)} saveLabel={t('save')} state={editState} />
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Confirm Delete Type */}
      <Dialog open={Boolean(typeToDelete)} onOpenChange={(open) => { if (!open) { setTypeToDelete(null); deleteFb.reset(); } }}>
        <DialogContent size="sm" className="bg-surface shadow-md">
          <DialogTitle className="font-heading text-[19px]">{t('deleteTypeTitle')}</DialogTitle>
          <DialogDescription className="text-[13px] text-muted-ink">
            {typeToDelete ? t('deleteTypeDescription', { label: typeToDelete.label }) : ''}
          </DialogDescription>
          <FormActionBar placement="dialog" cancel={() => setTypeToDelete(null)} destructive pending={deletePending} saveLabel={t('deleteTypeConfirm')} onSave={() => typeToDelete && handleDelete(typeToDelete.key)} state={deleteFb.state} />
        </DialogContent>
      </Dialog>
    </section>
  );
}

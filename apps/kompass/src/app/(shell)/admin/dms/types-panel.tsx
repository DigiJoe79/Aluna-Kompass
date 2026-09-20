'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { idleState } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { createDocumentTypeAction, updateDocumentTypeAction } from './actions';
import { Select } from '@/components/ui/select';
import { ActionForm } from '@/components/forms/action-form';

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

  const [createState, createAction, createPending] = useActionState(async (prev: any, formData: FormData) => {
    const res = await createDocumentTypeAction(prev, formData);
    if (res.status === 'success') setCreateOpen(false);
    return res;
  }, idleState);

  const [editState, editAction, editPending] = useActionState(async (prev: any, formData: FormData) => {
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
        <p className="text-[13px] text-muted-ink">
          {t('area')}: {areaLabel(current)}
        </p>
      ) : null;
    }

    const currentArea = current === null ? null : areas.find((area) => area.key === current);
    if (current !== null && !currentArea) {
      return <p className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{t('areaUnknown', { key: current })}</p>;
    }

    // Ändern darf nur, wer das Recht des jetzigen Bereichs selbst hat; die anderen stehen ausgegraut in der Liste.
    const locked = currentArea ? !currentArea.held : false;
    const chosen = areas.find((area) => area.key === areaValue);
    const changed = areaValue !== (current ?? '');
    const count = type.areaCount ?? 0;
    return (
      <div className="space-y-1.5">
        <Label htmlFor="edit-area">{t('area')}</Label>
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
      </div>
    );
  };

  return (
    <section className="space-y-4 rounded-md border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading text-[18px] text-ink">{t('typesTitle')}</h3>
          <p className="text-[13px] text-muted-ink">{t('typesDescription')}</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          {t('createType')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
            <TableRow className="h-9">
              <TableHead className="px-4">{t('typeColumns.prefix')}</TableHead>
              <TableHead className="px-4">{t('typeColumns.label')}</TableHead>
              <TableHead className="px-4">{t('typeColumns.key')}</TableHead>
              <TableHead className="px-4">{t('typeColumns.direction')}</TableHead>
              <TableHead className="px-4">{t('typeColumns.retention')}</TableHead>
              <TableHead className="px-4">{t('typeColumns.folder')}</TableHead>
              <TableHead className="px-4">{t('typeColumns.status')}</TableHead>
              <TableHead className="px-4 text-right">{t('typeColumns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((row, i) => (
              <TableRow key={row.key} className={cn('h-12 border-b border-line-2', i % 2 === 1 && 'bg-zebra')}>
                <TableCell className="px-4 font-mono font-bold text-ink">{row.prefix}</TableCell>
                <TableCell className="px-4 font-medium text-ink">{row.label}</TableCell>
                <TableCell className="px-4 font-mono text-[13px] text-muted-ink">{row.key}</TableCell>
                <TableCell className="px-4 text-ink-2">{tDms(`directions.${row.defaultDirection}`)}</TableCell>
                <TableCell className="px-4 text-ink-2">{t(`retentionClasses.${row.retentionClass}`)}</TableCell>
                <TableCell className="px-4 text-ink-2">{row.defaultFolder ?? '—'}</TableCell>
                <TableCell className="px-4">
                  <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>
                    {row.isActive ? t('active') : t('inactive')}
                  </StatusBadge>
                </TableCell>
                <TableCell className="px-4 text-right">
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Dialog: Create Type */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-surface shadow-md sm:max-w-[500px]">
          <ActionForm action={createAction} state={createState} className="space-y-4">
            <DialogTitle className="font-heading text-[19px]">{t('createTypeTitle')}</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-ink">{t('createTypeDescription')}</DialogDescription>

            {createState.status === 'error' && (
              <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{createState.message}</div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-key">{t('typeColumns.key')}</Label>
                <Input id="create-key" name="key" placeholder={t('typeKeyPlaceholder')} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-prefix">{t('typeColumns.prefix')}</Label>
                <Input id="create-prefix" name="prefix" placeholder={t('typeShortPlaceholder')} maxLength={3} required />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-label">{t('typeColumns.label')}</Label>
              <Input id="create-label" name="label" required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-direction">{t('typeColumns.direction')}</Label>
                <Select
                  id="create-direction"
                  name="defaultDirection"
                  defaultValue="incoming"
                >
                  <option value="incoming">{tDms('directions.incoming')}</option>
                  <option value="outgoing">{tDms('directions.outgoing')}</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="create-retention">{t('typeColumns.retention')}</Label>
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
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-folder">{t('typeColumns.folder')}</Label>
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
            </div>

            {areas.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="create-area">{t('area')}</Label>
                <Select id="create-area" name="protectionArea" defaultValue="">
                  <option value="">{t('areaNone')}</option>
                  {areas.map((area) => (
                    <option key={area.key} value={area.key} disabled={!area.held}>
                      {areaLabel(area.key)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={createPending}>
                {t('save')}
              </Button>
            </DialogFooter>
          </ActionForm>
        </DialogContent>
      </Dialog>

      {/* Dialog: Edit Type */}
      <Dialog open={Boolean(editingType)} onOpenChange={(open) => !open && setEditingType(null)}>
        <DialogContent className="bg-surface shadow-md sm:max-w-[500px]">
          {editingType && (
            <ActionForm action={editAction} state={editState} className="space-y-4">
              <DialogTitle className="font-heading text-[19px]">{t('editTypeTitle')}</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-ink">{t('editTypeDescription')}</DialogDescription>

              {editState.status === 'error' && (
                <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{editState.message}</div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-key">{t('typeColumns.key')}</Label>
                  <Input id="edit-key" value={editingType.key} disabled />
                  <p className="text-[12px] text-muted-ink">{t('typeImmutableHint')}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-prefix">{t('typeColumns.prefix')}</Label>
                  {editingType.ownerModule ? (
                    <Input id="edit-prefix" value={editingType.prefix} disabled />
                  ) : (
                    <>
                      <Input
                        id="edit-prefix"
                        name="prefix"
                        maxLength={3}
                        className="w-20 font-mono uppercase"
                        defaultValue={editingType.prefix}
                        required
                      />
                      <p className="text-[12px] text-muted-ink">{t('prefixHint')}</p>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-label">{t('typeColumns.label')}</Label>
                <Input id="edit-label" name="label" defaultValue={editingType.label} required />
              </div>

              {editingType.ownerModule ? (
                <p className="text-[13px] text-muted-ink">{t('ownedByModule', { module: editingType.ownerModule })}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-direction">{t('typeColumns.direction')}</Label>
                      <Select
                        id="edit-direction"
                        name="defaultDirection"
                        defaultValue={editingType.defaultDirection}
                      >
                        <option value="incoming">{tDms('directions.incoming')}</option>
                        <option value="outgoing">{tDms('directions.outgoing')}</option>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="edit-retention">{t('typeColumns.retention')}</Label>
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
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="edit-active"
                      name="isActive"
                      defaultChecked={editingType.isActive}
                      className="size-4 rounded border-line"
                    />
                    <Label htmlFor="edit-active" className="cursor-pointer text-[13px]">
                      {t('activeCheckbox')}
                    </Label>
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="edit-folder">{t('typeColumns.folder')}</Label>
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
              </div>

              {areaField(editingType)}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setEditingType(null)}>
                  {tCommon('cancel')}
                </Button>
                <Button type="submit" disabled={editPending}>
                  {t('save')}
                </Button>
              </DialogFooter>
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

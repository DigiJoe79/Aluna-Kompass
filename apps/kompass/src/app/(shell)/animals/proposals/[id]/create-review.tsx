'use client';

import type { AnimalRecord, PhotoChoice, PhotoCrop, ProposalHint, ProposalReview } from '@kompass/module-animals';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard } from '@/components/forms/form-card';
import { FormErrorSummary } from '@/components/forms/form-error-summary';
import { Notice } from '@/components/notice';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { lineTabsListClass, lineTabsTriggerClass, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { idleState, type ActionState } from '@/lib/actions';
import { applyCrop, switchPrimaryCrop } from '@/lib/primary-crop';
import { cn } from '@/lib/utils';
import { ProfileFields, TextFields } from '../../animal-fields';
import { CropLine, PhotoActions, PhotoCropDialog, PhotoTileImage, usePhotoPlaces, type AnimalPhotoPlaces } from '../../photo-tile';
import { animalFieldsFromForm, changedFields, type AnimalFormFields } from '../../form-values';
import { acceptProposalAction, rejectProposalAction } from '../actions';
import { AcceptDialog } from '../accept-dialog';
import { fieldLabelKey } from '../field-format';
import { RejectDialog } from '../reject-dialog';
import { choicesDiffer, srcOf, type ReviewPhotoRow } from './photo-review';
import { HintLines } from './review-values';
import { setPreviewChoice } from './preview-choice';
import { useDecisionDone } from './use-decision';

type Tab = 'profile' | 'content';
/** Welches Feld auf welchem Reiter steht — für „Zum Feld“ und den Punkt am Reiter (wie `TABS` der Maske). */
const CONTENT_FIELDS: readonly string[] = ['summary', 'body', 'traits', 'photos'];
const tabOf = (field: string): Tab => (CONTENT_FIELDS.includes(field) ? 'content' : 'profile');
const FORM_ID = 'proposal-create-form';

/** Punkt am Reiter: Dort steht ein Zweifelsfall. */
// Ein Zweifelsfall ist eine Einordnung, nicht maschinell: Ton `neutral` (Runde 3, 049/051).
const HintDot = ({ label }: { label: string }) => <span className="ml-1.5 size-[7px] rounded-full bg-muted-ink" role="img" aria-label={label} />;

/** Ein Foto im Editor der Prüfung: Reihenfolge, Titelbild, „weglassen“ (die Kachel bleibt, bis angenommen ist), geltender Ausschnitt. */
type EditorRow = { row: ReviewPhotoRow; omitted: boolean; primary: boolean; crop: PhotoCrop | null };

/** Das Titelbild der Liste: das gewählte unter den übernommenen, sonst das erste (wie der Dienst). */
const primaryKeyOf = (list: readonly EditorRow[]): string | null => {
  const included = list.filter((p) => !p.omitted);
  return (included.find((p) => p.primary) ?? included[0])?.row.key ?? null;
};

/**
 * Prüfseite eines neuen Hundes (Spec § 6, Board 4a): dieselbe Maske wie `/animals/new`, vorbefüllt; die
 * Zweifelsfälle als Spalte daneben mit „Zum Feld“. Keine Statuskarte: Veröffentlichen steht im Annehmen-Dialog.
 */
export function CreateReview({ review, locales, nextHref, backHref, canFollowUp, maxPhotos, photoPlaces }: { review: ProposalReview; locales: string[]; nextHref: string; backHref: string; canFollowUp: boolean; maxPhotos: number; photoPlaces: AnimalPhotoPlaces }) {
  const t = useTranslations('animals.proposals.create');
  const r = useTranslations('animals.proposals.review');
  const a = useTranslations('animals.proposals.accept');
  const f = useTranslations('animals.form');
  const ph = useTranslations('animals.proposals.photoReview');
  const root = useTranslations();
  const pr = useTranslations('animals.proposals');
  const pc = useTranslations('media.crop');
  const { proposal } = review;
  const values = (proposal.values ?? {}) as Partial<AnimalRecord> & Record<string, unknown>;
  const name = proposal.name || pr('unnamed');
  const done = useDecisionDone(nextHref);
  const [tab, setTab] = useState<Tab>('profile');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [changed, setChanged] = useState(0);
  const [fields, setFields] = useState<AnimalFormFields | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const initialPhotos = (review.photos ?? []).map((row) => ({ row, omitted: false, primary: row.proposedPrimary, crop: row.crop }));
  const [photos, setPhotos] = useState<EditorRow[]>(initialPhotos);
  const at = usePhotoPlaces(photoPlaces);
  const [editing, setEditing] = useState<string | null>(null);
  // Beim Titelbildwechsel entfernte Ausschnitte (gemerkt bis zum Annehmen) und die letzte Ansage (Board 4).
  const [removed, setRemoved] = useState<Record<string, PhotoCrop>>({});
  const [announcement, setAnnouncement] = useState('');
  const photoName = (row: ReviewPhotoRow) => row.sourceRef ?? ph('sourcePhoto');
  // Jede Änderung der Liste läuft durch die Titelbild-Regel: „Als Titelbild“, weglassen, zurückholen, umsortieren.
  const changePhotos = (next: EditorRow[]) => {
    const before = primaryKeyOf(photos);
    const after = primaryKeyOf(next);
    const res = switchPrimaryCrop({ crops: Object.fromEntries(next.map((p) => [p.row.key, p.crop])), removed }, before ? { key: before, stays: next.some((p) => p.row.key === before && !p.omitted) } : null, after);
    setRemoved(res.removed as Record<string, PhotoCrop>);
    if (before && after && before !== after) {
      const nameOf = (key: string) => photoName(next.find((p) => p.row.key === key)!.row);
      setAnnouncement(res.removedFrom ? pc('primaryMoved', { new: nameOf(after), old: nameOf(before) }) : '');
    }
    setPhotos(next.map((p) => ((res.crops[p.row.key] ?? null) === p.crop ? p : { ...p, crop: res.crops[p.row.key] ?? null })));
  };
  const primaryKey = primaryKeyOf(photos);
  const edited = editing === null ? undefined : photos.find((p) => p.row.key === editing);
  const hints: (ProposalHint & { field?: string })[] = [...review.fields.flatMap((row) => row.hints), ...review.generalHints];
  const marks = new Set(hints.flatMap((h) => (h.field ? [h.field] : [])));
  const tabMarked = (key: Tab) => [...marks].some((m) => tabOf(m) === key);
  const included = photos.filter((p) => !p.omitted);
  const choices: PhotoChoice[] = included.map((p, i) => {
    const primary = included.some((x) => x.primary) ? p.primary : i === 0;
    return p.row.imageId ? { imageId: p.row.imageId, isPrimary: primary, crop: p.crop } : { mediaId: p.row.mediaId!, isPrimary: primary, crop: p.crop };
  });
  // Die Vorschau im Kopf zeigt die Werte des Vorschlags mit der Fotowahl dieser Seite (Board 7b).
  useEffect(() => setPreviewChoice(proposal.id, { photos: review.photos ? choices : undefined }), [proposal.id, photos]); // eslint-disable-line react-hooks/exhaustive-deps
  // Wie der Dienst: Weglassen und ein anderes Titelbild sind Änderungen, die Reihenfolge nicht (Reviewer I5).
  const photosChanged = review.photos ? choicesDiffer(review.photos, choices) : false;
  const labels: Record<string, string> = Object.fromEntries(['name', 'sex', 'location', 'place', 'sizeCm', 'externalProfileUrl', 'birthText', 'sizeText', 'summary', 'body', 'traits'].map((k) => [k, f(k as 'name')]));

  const goTo = (field: string) => {
    const target = tabOf(field);
    setTab(target);
    requestAnimationFrame(() => {
      const id = field === 'traits' ? 'traits__text' : field;
      (document.getElementById(id) ?? document.getElementById(`${id}-${locales[0] ?? 'de'}`))?.focus();
    });
  };
  const move = (i: number, d: number) => { const n = [...photos]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); changePhotos(n); };

  const accept = async (extra: { publish?: boolean; adoptedYear?: number; followUp?: { dueAt: string; title: string } }): Promise<ActionState> => {
    // Nur Geändertes: Den Rest (auch den Status) nimmt der Dienst aus dem Vorschlag (Reviewer: sonst immer „mit Änderungen“).
    const state = await acceptProposalAction({ id: proposal.id, values: changedFields(fields!, values, locales), photos: review.photos ? choices : undefined, ...extra }, fields?.name || name);
    if (state.status === 'error' && Object.keys(state.fieldErrors).some((k) => k in labels)) {
      // Felder der Maske: Die Fehler stehen am Feld und oben in der Liste, der Dialog schließt (MUSTER § A).
      setErrors(state.fieldErrors);
      setFields(null);
      return { status: 'idle' } as ActionState;
    }
    return done(state);
  };

  return (
    <div className="flex flex-col gap-4">
      {review.sameNameAnimals.length > 0 ? (
        <Notice level="warn" title={t('sameName', { name: proposal.name })}>
          <span className="flex flex-col gap-1">
            <span>
              {review.sameNameAnimals.map((x, i) => (
                <span key={x.id}>
                  {i > 0 ? ', ' : null}
                  <Link href={`/animals/${x.id}`} className="underline underline-offset-2 hover:text-link">{x.name}</Link>
                </span>
              ))}
            </span>
            <span>{t('sameNameHelp')}</span>
          </span>
        </Notice>
      ) : null}
      <FormErrorSummary errors={errors} labels={labels} />
      <div className="@container">
        <div className="flex flex-col gap-5 @[1100px]:grid @[1100px]:grid-cols-[1fr_320px] @[1100px]:items-start">
          {hints.length > 0 ? (
            <aside className="flex flex-col gap-3 @[1100px]:order-2" aria-label={t('hintsTitle', { count: hints.length })} data-testid="proposal-hints">
              <Section title={t('hintsTitle', { count: hints.length })}>
              <div className="flex flex-col gap-3">
              {hints.map((h, i) => (
                <div key={i} className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-3 text-meta">
                  <span className="font-semibold text-ink">
                    {h.title ?? (h.field ? root(fieldLabelKey(h.field as 'name')) : r('hint'))}
                    {h.field ? ` · ${t('onTab', { tab: f(`tabs.${tabOf(h.field)}`) })}` : ''}
                  </span>
                  <HintLines hints={[{ ...h, title: undefined }]} />
                  {h.field ? (
                    <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => goTo(h.field!)}>
                      {t('toField')}
                    </Button>
                  ) : null}
                </div>
              ))}
              </div>
              </Section>
              <p className="text-hint text-ink-2">{t('hintsNote')}</p>
            </aside>
          ) : null}
          <FormCard className="min-w-0 @[1100px]:order-1">
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
              <TabsList variant="line" className={cn(lineTabsListClass, 'px-5')}>
                {/* Zwei Reiter ausgeschrieben, nicht als Schleife: Der Wächter `no-single-tab` zählt sie im Quelltext. */}
                <TabsTrigger value="profile" className={lineTabsTriggerClass}>
                  {f('tabs.profile')}
                  {tabMarked('profile') ? <HintDot label={r('hint')} /> : null}
                </TabsTrigger>
                <TabsTrigger value="content" className={lineTabsTriggerClass}>
                  {f('tabs.content')}
                  {tabMarked('content') ? <HintDot label={r('hint')} /> : null}
                </TabsTrigger>
                {/* Kein Reiter „Geschichte“: Ein Vorschlag bringt nie eine mit, ausgegraut wirkte er kaputt (Befund 10). */}
              </TabsList>
              <ActionForm id={FORM_ID} state={idleState} action={(data) => { setErrors({}); setFields(animalFieldsFromForm(data, locales)); }}>
                <TabsContent keepMounted value="profile" className="p-5">
                  <ProfileFields values={values} locales={locales} errors={errors} marks={marks} />
                </TabsContent>
                <TabsContent keepMounted value="content" className="p-5">
                  <div className="flex flex-col gap-5">
                    <TextFields values={values} locales={locales} errors={errors} marks={marks} />
                    {review.photos ? (
                      // Linie von Hand: Davor stehen die Textfelder, keine `Section` (MUSTER § E).
                      <div className="min-w-0 border-t border-line pt-5">
                        <Section title={t('photosTitle', { count: included.length, max: maxPhotos })}>
                        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {photos.map((p, i) => (
                            <li key={p.row.key} data-testid="proposal-photo" className={cn('flex flex-col gap-1.5 rounded-md border p-2', p.primary && !p.omitted ? 'border-brand' : 'border-line', p.omitted && 'opacity-60')}>
                              {/* Kachel wie im Tierformular (Board Ausschnitt in der Prüfung 1a): das Ergebnis im Format der Stelle. */}
                              <PhotoTileImage src={srcOf(p.row)} crop={p.crop} isPrimary={!p.omitted && p.row.key === primaryKey} places={at} label={p.crop ? ph('withCrop', { name: photoName(p.row) }) : photoName(p.row)} />
                              <CropLine crop={p.crop} width={p.row.width} isPrimary={!p.omitted && p.row.key === primaryKey} places={at} />
                              {p.omitted ? (
                                <PhotoActions className="text-meta text-ink-2">
                                  {t('omitted')}
                                  <Button type="button" variant="outline" size="sm" onClick={() => changePhotos(photos.map((x, j) => (j === i ? { ...x, omitted: false } : x)))}>{t('restore')}</Button>
                                </PhotoActions>
                              ) : (
                                <PhotoActions>
                                  {/* Titelbild als Marke am gewählten Foto, nicht als Hauptknopf in jeder Kachel (Befund 10). */}
                                  {p.primary ? (
                                    <StatusBadge tone="neutral" testId="proposal-photo-primary">{ph('primary')}</StatusBadge>
                                  ) : (
                                    <Button type="button" size="sm" variant="outline" onClick={() => changePhotos(photos.map((x, j) => ({ ...x, primary: j === i })))}>{t('makePrimary')}</Button>
                                  )}
                                  <Button type="button" size="icon-sm" variant="ghost" disabled={i === 0} aria-label={t('moveLeft')} onClick={() => move(i, -1)}><ArrowLeft aria-hidden /></Button>
                                  <Button type="button" size="icon-sm" variant="ghost" disabled={i === photos.length - 1} aria-label={t('moveRight')} onClick={() => move(i, 1)}><ArrowRight aria-hidden /></Button>
                                  {p.row.width && p.row.height ? <Button type="button" size="sm" variant="outline" onClick={() => setEditing(p.row.key)}>{pc('edit')}</Button> : null}
                                  <Button type="button" size="sm" variant="outline" onClick={() => changePhotos(photos.map((x, j) => (j === i ? { ...x, omitted: true, primary: false } : x)))}>{t('omit')}</Button>
                                </PhotoActions>
                              )}
                            </li>
                          ))}
                        </ul>
                        {/* Ein Dialog für alle Kacheln, auf dem Quellbild; „Übernehmen“ setzt den Ausschnitt im Stand der Seite. */}
                        <PhotoCropDialog
                          photo={edited ? { src: srcOf(edited.row), width: edited.row.width, height: edited.row.height, crop: edited.crop, isPrimary: edited.row.key === primaryKey } : undefined}
                          onClose={() => setEditing(null)}
                          places={at}
                          note={pc('noteAccept')}
                          onApply={(crop) => {
                            setRemoved(applyCrop({ crops: {}, removed }, edited!.row.key, crop).removed as Record<string, PhotoCrop>);
                            setPhotos(photos.map((x) => (x.row.key === edited!.row.key ? { ...x, crop } : x)));
                          }}
                        />
                        <p data-testid="primary-crop-announcement" aria-live="polite" className="sr-only">{announcement}</p>
                        </Section>
                      </div>
                    ) : null}
                  </div>
                </TabsContent>
                <FormActionBar
                  mode="create"
                  hideDiscard
                  note={t('prefilled', { source: proposal.sourceName })}
                  back={{ href: backHref, label: r('backToList') }}
                  saveLabel={a('open')}
                  onChangedCount={setChanged}
                  extraActions={
                    <Button type="button" variant="outline" onClick={() => setRejecting(true)}>
                      {root('animals.proposals.reject.open')}
                    </Button>
                  }
                />
              </ActionForm>
            </Tabs>
          </FormCard>
        </div>
      </div>
      <AcceptDialog
        open={fields !== null}
        onOpenChange={(open) => { if (!open) setFields(null); }}
        title={a('titleCreate', { name: fields?.name || name })}
        summary={{ taken: [], kept: [], photos: null }}
        kind="create"
        sourceName={proposal.sourceName}
        willChange={changed > 0 || photosChanged}
        askYear={values.status === 'adopted'}
        canFollowUp={canFollowUp}
        defaultYear={typeof values.adoptedYear === 'number' ? values.adoptedYear : undefined}
        photoCount={review.photos ? included.length : 0}
        onAccept={accept}
      />
      <RejectDialog open={rejecting} onOpenChange={setRejecting} sourceName={proposal.sourceName} onReject={async (reason) => done(await rejectProposalAction(proposal.id, reason, name))} />
    </div>
  );
}

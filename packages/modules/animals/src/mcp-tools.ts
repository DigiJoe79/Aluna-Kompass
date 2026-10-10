import type { McpToolDefinition } from '@kompass/core';
import { acceptProposal, proposalAcceptSchema, proposalRejectSchema, proposalResolveDelistedSchema, rejectProposal, resolveDelistedNotice } from './proposals/decide';
import { stageProposalImage } from './proposals/images';
import { listAnimalOrigins } from './proposals/origins';
import { getProposal, listProposals, proposalListSchema } from './proposals/review';
import { proposalSubmitSchema } from './proposals/model';
import { proposalsStatus, proposalsStatusSchema, proposalWithdrawSchema, submitProposal, withdrawProposal } from './proposals/submit';
import { z } from 'zod';
import { animalCreateSchema, animalDeleteSchema, animalDeletionPreview, animalListSchema, animalPhotosSchema, animalReviewRequestSchema, animalStatusSchema, animalStorySchema, animalUpdateSchema, createAnimal, deleteAnimal, getAnimal, listAnimals, MAX_ANIMAL_PHOTOS, requestAnimalReview, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory, updateAnimal } from './service';

const t = (name: string, description: string, inputSchema: z.ZodType<unknown>, handler: McpToolDefinition['handler'], service: McpToolDefinition['service']): McpToolDefinition => ({ name, description, inputSchema, handler, service });

export const ANIMALS_MCP_TOOLS: McpToolDefinition[] = [
  t('animals_list', 'List animals as short rows without texts: id, slug, name, status, location, flags, publication, review marker, photo count. Optional filters: text (name or slug contains), status, location, isPublished, reviewPending; orderBy { field: name | createdAt | updatedAt | reviewRequestedAt, direction }; origin { externalRef, sourceUserId? } finds the animal linked to an entry at a source. Returns { animals, total, reviewPending }; the two counters are unfiltered. For texts, photos and story of one animal use animals_get. Requires animals.view.', animalListSchema, (deps, ctx, args) => listAnimals(deps, ctx, args), listAnimals),
  t('animals_get', 'Read one animal profile with photos, story and review marker (reviewRequestedAt, reviewNote). Requires animals.view.', z.object({ id: z.string() }), (deps, ctx, args) => getAnimal(deps, ctx, (args as { id: string }).id), getAnimal),
  t('animals_create', 'Create an animal profile (unpublished). Requires animals.manage. Kompass makes the slug from name and id (e.g. luna-7k3f); it stays fixed, also when the name changes, and cannot be passed. place: free text, not localized, e.g. shelter country or town, or the federal state of a foster home. When the setting animals.review.onMcpWrite is on, writing through MCP marks the profile for review by a human; add what to check with animals_request_review.', animalCreateSchema.strict(), (deps, ctx, args) => createAnimal(deps, ctx, args), createAnimal),
  t('animals_update', 'Update an animal profile. The slug is fixed and cannot be changed. Requires animals.manage. Localized fields are replaced as a whole map; to change one locale use translations_set. Pass expectedVersion (the updatedAt you last read) to be rejected with staleVersion instead of overwriting a change made in between. place: free text, not localized, e.g. shelter country or town, or the federal state of a foster home. When the setting animals.review.onMcpWrite is on, writing through MCP marks the profile for review by a human; add what to check with animals_request_review.', animalUpdateSchema.strict(), (deps, ctx, args) => updateAnimal(deps, ctx, args), updateAnimal),
  t('animals_set_status', 'Change adoption status of an animal. Requires animals.manage.', animalStatusSchema, (deps, ctx, args) => setAnimalStatus(deps, ctx, args), setAnimalStatus),
  t('animals_set_photos', `Replace photo gallery of an animal, at most ${MAX_ANIMAL_PHOTOS} photos. Requires animals.manage. When the setting animals.review.onMcpWrite is on, writing through MCP marks the profile for review by a human; add what to check with animals_request_review. Each photo may carry crop { x, y, w, h } (fractions 0–1 of the displayed image); omitted keeps the stored crop of that photo, null removes it.`, animalPhotosSchema, (deps, ctx, args) => setAnimalPhotos(deps, ctx, args), setAnimalPhotos),
  t('animals_set_story', 'Set adoption success story of an adopted animal. Requires animals.manage. Localized fields are replaced as a whole map; to change one locale use translations_set. Pass expectedVersion (the updatedAt you last read) to be rejected with staleVersion instead of overwriting a change made in between. When the setting animals.review.onMcpWrite is on, writing through MCP marks the profile for review by a human; add what to check with animals_request_review.', animalStorySchema, (deps, ctx, args) => setAnimalStory(deps, ctx, args), setAnimalStory),
  t('animals_request_review', 'Mark an animal profile for review by a human and say what to check in note (max 500 characters, no personal data). Use it after changing a profile, or when nothing changed but a human should look (e.g. no longer listed at the partner). Only a human can confirm the review, in the web interface. Requires animals.manage.', animalReviewRequestSchema, (deps, ctx, args) => requestAnimalReview(deps, ctx, args), requestAnimalReview),
  t('animals_set_published', 'Publish or unpublish an animal profile. Requires animals.manage.', z.object({ id: z.string(), isPublished: z.boolean() }), (deps, ctx, args) => setAnimalPublished(deps, ctx, args), setAnimalPublished),
  t('animals_deletion_preview', 'Tell whether an animal profile can be deleted: still published, held by retention, still referenced (documents, open follow-ups), and which photos are used nowhere else. Call this before animals_delete. Requires animals.view.', z.object({ id: z.string() }), (deps, ctx, args) => animalDeletionPreview(deps, ctx, (args as { id: string }).id), animalDeletionPreview),
  t('animals_delete', 'Delete an animal profile with its photo assignments and success story (editorial content, audited). Two steps: a published profile must be unpublished first. Refused while a retention hold runs or a document or open follow-up still points at it. deleteOrphanedMedia also deletes the photos used nowhere else and needs media.upload. Requires animals.manage.', animalDeleteSchema, (deps, ctx, args) => deleteAnimal(deps, ctx, args), deleteAnimal),
  t(
    'animals_proposal_image_stage',
    'Stage one image for a proposal: filename plus base64 content (no data-URL prefix), optional sourceRef (your id of the image). JPEG, PNG or WebP, at most 10 MB. Returns imageId; pass it in the photos of animals_proposal_submit. An image not used by a proposal is deleted after 24 hours. Staged images are not in the media library; only an accepted proposal moves them there. Requires animals.propose and the setting animals.proposals.enabled.',
    z.object({ filename: z.string().min(1).max(200), contentBase64: z.string().min(1), sourceRef: z.string().trim().min(1).max(200).optional() }).strict(),
    (deps, ctx, args) => {
      const a = args as { filename: string; contentBase64: string; sourceRef?: string };
      return stageProposalImage(deps, ctx, { originalName: a.filename, bytes: new Uint8Array(Buffer.from(a.contentBase64, 'base64')), sourceRef: a.sourceRef });
    },
    stageProposalImage,
  ),
  t(
    'animals_proposal_submit',
    'Propose a new animal (kind create: externalRef and all form values), a change (update: animalId and only the changed values; localized fields as a whole map; status is a value like any other), a notice (notice: animalId, reason, optional noticeKind delisted when the animal is no longer listed at the source) or a match (sameAs: animalId of the Kompass animal you think is your entry externalRef, with reason). hints: your doubts, each with title and/or field, quote from your source and suggestion. photos (max 12): imageId from animals_proposal_image_stage or mediaId of a current photo of the animal, optional sourceRef, isPrimary, crop {x,y,w,h} as fractions. sourceKey makes the call idempotent: the same key returns the existing proposal. A new update for the same animal replaces your open one; a new create with the same externalRef replaces your open create. Nothing changes in Kompass until a human accepts. Requires animals.propose and the setting animals.proposals.enabled.',
    proposalSubmitSchema,
    (deps, ctx, args) => submitProposal(deps, ctx, args),
    submitProposal,
  ),
  t('animals_proposal_withdraw', 'Withdraw your own open proposal by sourceKey, with a reason. Requires animals.propose.', proposalWithdrawSchema, (deps, ctx, args) => withdrawProposal(deps, ctx, args), withdrawProposal),
  t(
    'animals_proposals_status',
    'Read back your own proposals: state (open, accepted, acceptedWithChanges, rejected, replaced, withdrawn), decidedAt, decisionNote, decisionReason (animalDeleted), animalId (for create: the new animal after acceptance), sameAsAnswer (same: your externalRef now belongs to animalId; different), and final: the accepted values and the full photo list after acceptance with mediaId, your sourceRef where the photo came from you, position, isPrimary, crop. Filter by sourceKeys, since (updatedAt ≥ since, ISO), state; at most limit (default 100, max 500), oldest change first. 90 days after the decision values and final are cleared (cleared: true). Requires animals.propose.',
    proposalsStatusSchema,
    (deps, ctx, args) => proposalsStatus(deps, ctx, args),
    proposalsStatus,
  ),
  t(
    'animals_proposal_accept',
    'Accept an open proposal. Without fields, each proposed field is taken, except fields changed in Kompass since the proposal (conflicts): those keep today’s value and are listed in keptForConflict; pass fields { field: proposal | current } to decide explicitly, values to take edited values. photos: the full photo list afterwards (imageId of the proposal or mediaId); omitted = default: new and named photos in, photos of this source no longer named out, other photos kept. create: publish true/false (default false). sameAs: sameAsAnswer same | different (required). notice: acknowledges it. status adopted needs adoptedYear. Pass expectedVersion (updatedAt of the animal you reviewed) to be refused with staleVersion after a change in between. Requires animals.manage.',
    proposalAcceptSchema,
    (deps, ctx, args) => acceptProposal(deps, ctx, args),
    acceptProposal,
  ),
  t('animals_proposal_reject', 'Reject an open proposal; note is optional and goes back to the source. Staged images are deleted, nothing reaches the media library. Requires animals.manage.', proposalRejectSchema, (deps, ctx, args) => rejectProposal(deps, ctx, args), rejectProposal),
  t(
    'animals_proposal_resolve_delisted',
    'For an open notice with noticeKind delisted: set the animal to adopted (adoptedYear defaults to the current year), unpublish it if published, and acknowledge the notice, in one step; steps already done are skipped and the result lists the steps taken. Requires animals.manage.',
    proposalResolveDelistedSchema,
    (deps, ctx, args) => resolveDelistedNotice(deps, ctx, args),
    resolveDelistedNotice,
  ),
  t(
    'animals_proposals_list',
    'List proposals for review (the inbox): kind, state, source name, animal name, proposed fields, photo counts, conflicts, doubts (hints), what a new animal is missing (primaryPhoto, summary), decider from the audit log. Filters: state (open, decided, all or one state; default open), kind, sourceUserId, animalId, text (name contains). Oldest first; open counters are unfiltered. Requires animals.manage.',
    proposalListSchema,
    (deps, ctx, args) => listProposals(deps, ctx, args),
    listProposals,
  ),
  t(
    'animals_proposal_get',
    'Read one proposal side by side with the animal today: per proposed field today, proposal, value at proposal time and, for a field changed in Kompass since, who and when; photo rows new/kept/dropped with the default choice; doubts per field; animals with the same name; origins. Requires animals.manage.',
    z.object({ id: z.string() }),
    (deps, ctx, args) => getProposal(deps, ctx, (args as { id: string }).id),
    getProposal,
  ),
  t('animals_origins_list', 'List where an animal comes from: source, externalRef, externalUrl. Requires animals.view.', z.object({ animalId: z.string() }), (deps, ctx, args) => listAnimalOrigins(deps, ctx, (args as { animalId: string }).animalId), listAnimalOrigins),
];

import { moduleImagePlaces, ok, type McpToolDefinition } from '@kompass/core';
import { z } from 'zod';
import { createProject, deleteProject, getProject, listProjects, projectCreateSchema, projectDeleteSchema, projectDeletionPreview, projectUpdateSchema, reorderProjects, setProjectPublished, updateProject } from './service';

/** Spec Ausschnitt für alle Bilder § 5: Format der Stelle erwartet, ein anderes wird nicht abgelehnt. */
const IMAGE_CROP_HINT =
  'imageCrop { x, y, w, h } (fractions 0–1 of the displayed image) cuts the image for the website; the website uses it in a derived image id. Expected in the format of the place (read imagePlaces of project_get); another format is accepted, the website then trims it further. Without an image there is no crop.';

const t = <T>(def: McpToolDefinition<T>): McpToolDefinition => def as McpToolDefinition;

/** Die Werkzeugnamen stammen aus der Zeit, als die Projekte im Kern lagen; ein Client soll nichts umlernen. */
export const PROJECTS_MCP_TOOLS: readonly McpToolDefinition[] = [
  t({ name: 'projects_list', description: 'List projects with their public fields and external links. Requires projects.view.', inputSchema: z.object({}), handler: (deps, ctx) => listProjects(deps, ctx), service: listProjects }),
  t({
    name: 'project_get',
    description: 'Read one project, with imageCrop. imagePlaces["projects.image"] gives the formats a crop of the image should have (one = fixed, several = choose one, none = any) and the places of the website with ratio and minWidthPx (a crop narrower than that in original pixels is shown smaller). Requires projects.view.',
    inputSchema: z.object({ id: z.string() }),
    handler: async (deps, ctx, { id }) => {
      const got = await getProject(deps, ctx, id);
      return got.ok ? ok({ ...got.value, imagePlaces: moduleImagePlaces(deps, 'projects') }) : got;
    },
    service: getProject,
  }),
  t({ name: 'project_create', description: `Create a project (unpublished). External links are label plus http(s) url. ${IMAGE_CROP_HINT} Requires projects.manage. Audited.`, inputSchema: projectCreateSchema, handler: (deps, ctx, args) => createProject(deps, ctx, args), service: createProject }),
  t({ name: 'project_update', description: `Update a project. ${IMAGE_CROP_HINT} Omitted imageCrop keeps the stored crop while the image stays the same, another image without a new crop drops it, null removes it. Requires projects.manage. Audited. Localized fields are replaced as a whole map; to change one locale use translations_set. Pass expectedVersion (the updatedAt you last read) to be rejected with staleVersion instead of overwriting a change made in between.`, inputSchema: projectUpdateSchema, handler: (deps, ctx, args) => updateProject(deps, ctx, args), service: updateProject }),
  t({ name: 'project_set_published', description: 'Publish or unpublish a project. Requires projects.manage. Audited.', inputSchema: z.object({ id: z.string(), isPublished: z.boolean() }), handler: (deps, ctx, args) => setProjectPublished(deps, ctx, args), service: setProjectPublished }),
  t({ name: 'projects_reorder', description: 'Reorder projects; the order decides what a template shows first. Requires projects.manage.', inputSchema: z.object({ ids: z.array(z.string()) }), handler: (deps, ctx, args) => reorderProjects(deps, ctx, args), service: reorderProjects }),
  t({ name: 'project_deletion_preview', description: 'Tell whether a project can be deleted: still published, held by retention, still referenced (documents, open follow-ups), and whether its image is used nowhere else. Call this before project_delete. Requires projects.view.', inputSchema: z.object({ id: z.string() }), handler: (deps, ctx, { id }) => projectDeletionPreview(deps, ctx, id), service: projectDeletionPreview }),
  t({ name: 'project_delete', description: 'Delete a project (editorial content, audited). Two steps: a published project must be unpublished first. Refused while a retention hold runs or a document or open follow-up still points at it. deleteOrphanedMedia also deletes the image if nothing else uses it and needs media.upload. Requires projects.manage.', inputSchema: projectDeleteSchema, handler: (deps, ctx, args) => deleteProject(deps, ctx, args), service: deleteProject }),
];

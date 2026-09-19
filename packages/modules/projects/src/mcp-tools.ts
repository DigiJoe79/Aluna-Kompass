import type { McpToolDefinition } from '@kompass/core';
import { z } from 'zod';
import { createProject, deleteProject, getProject, listProjects, projectCreateSchema, projectDeleteSchema, projectDeletionPreview, projectUpdateSchema, reorderProjects, setProjectPublished, updateProject } from './service';

const t = <T>(def: McpToolDefinition<T>): McpToolDefinition => def as McpToolDefinition;

/** Die Werkzeugnamen stammen aus der Zeit, als die Projekte im Kern lagen; ein Client soll nichts umlernen. */
export const PROJECTS_MCP_TOOLS: readonly McpToolDefinition[] = [
  t({ name: 'projects_list', description: 'List projects with their public fields and external links. Requires projects.view.', inputSchema: z.object({}), handler: (deps, ctx) => listProjects(deps, ctx), service: listProjects }),
  t({ name: 'project_get', description: 'Read one project. Requires projects.view.', inputSchema: z.object({ id: z.string() }), handler: (deps, ctx, { id }) => getProject(deps, ctx, id), service: getProject }),
  t({ name: 'project_create', description: 'Create a project (unpublished). External links are label plus http(s) url. Requires projects.manage. Audited.', inputSchema: projectCreateSchema, handler: (deps, ctx, args) => createProject(deps, ctx, args), service: createProject }),
  t({ name: 'project_update', description: 'Update a project. Requires projects.manage. Audited. Localized fields are replaced as a whole map; to change one locale use translations_set. Pass expectedVersion (the updatedAt you last read) to be rejected with staleVersion instead of overwriting a change made in between.', inputSchema: projectUpdateSchema, handler: (deps, ctx, args) => updateProject(deps, ctx, args), service: updateProject }),
  t({ name: 'project_set_published', description: 'Publish or unpublish a project. Requires projects.manage. Audited.', inputSchema: z.object({ id: z.string(), isPublished: z.boolean() }), handler: (deps, ctx, args) => setProjectPublished(deps, ctx, args), service: setProjectPublished }),
  t({ name: 'projects_reorder', description: 'Reorder projects; the order decides what a template shows first. Requires projects.manage.', inputSchema: z.object({ ids: z.array(z.string()) }), handler: (deps, ctx, args) => reorderProjects(deps, ctx, args), service: reorderProjects }),
  t({ name: 'project_deletion_preview', description: 'Tell whether a project can be deleted: still published, held by retention, still referenced (documents, open follow-ups), and whether its image is used nowhere else. Call this before project_delete. Requires projects.view.', inputSchema: z.object({ id: z.string() }), handler: (deps, ctx, { id }) => projectDeletionPreview(deps, ctx, id), service: projectDeletionPreview }),
  t({ name: 'project_delete', description: 'Delete a project (editorial content, audited). Two steps: a published project must be unpublished first. Refused while a retention hold runs or a document or open follow-up still points at it. deleteOrphanedMedia also deletes the image if nothing else uses it and needs media.upload. Requires projects.manage.', inputSchema: projectDeleteSchema, handler: (deps, ctx, args) => deleteProject(deps, ctx, args), service: deleteProject }),
];

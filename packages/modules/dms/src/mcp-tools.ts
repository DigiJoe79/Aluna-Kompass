import type { McpToolDefinition } from '@kompass/core';
import { z } from 'zod';
import {
  createDocumentType,
  documentTypeCreateSchema,
  documentTypeListSchema,
  listDocumentTypes,
} from './catalog';
import { suggestClassification, suggestSchema } from './classification';
import {
  createDraft,
  deleteDraft,
  draftCreateSchema,
  draftUpdateSchema,
  fileDocument,
  updateDraft,
} from './drafts';
import { receiveDocument, receiveSchema } from './incoming';
import {
  documentListSchema,
  getDocument,
  linkDocument,
  linkSchema,
  listDocuments,
  moveDocument,
  voidDocument,
} from './service';
import { reindexAllDocuments } from './text';

const t = (
  name: string,
  description: string,
  inputSchema: z.ZodType<unknown>,
  handler: McpToolDefinition['handler'],
): McpToolDefinition => ({ name, description, inputSchema, handler });

const voidSchema = z.object({ id: z.string().min(1), reason: z.string().trim().min(1).max(300) });

export const DMS_MCP_TOOLS: McpToolDefinition[] = [
  t('dms_list', 'List and search documents in the file. Filters by direction, type, folder, phase or linked entity; the text filter searches subject, number and the recognised full text, and returns the passage with its page number for every full-text hit. Terms shorter than three characters do not reach the full text. Requires dms.view.', documentListSchema, (deps, ctx, args) => listDocuments(deps, ctx, args)),
  t('dms_get', 'Read one document with its metadata and links. Requires dms.view.', z.object({ id: z.string() }), (deps, ctx, args) => getDocument(deps, ctx, (args as { id: string }).id)),
  t('dms_types', 'List the document types with their number prefix and retention class. Requires dms.view.', documentTypeListSchema, (deps, ctx, args) => listDocumentTypes(deps, ctx, args)),
  t('dms_suggest_classification', 'Suggest type, folder and document date for a file about to be filed. Reads only, files nothing. Requires dms.view.', suggestSchema, (deps, ctx, args) => suggestClassification(deps, ctx, args)),
  t('dms_create_draft', 'Create an outgoing draft with subject, markdown body and links. Requires dms.create.', draftCreateSchema, (deps, ctx, args) => createDraft(deps, ctx, args)),
  t('dms_update_draft', 'Change a draft that has not been filed yet. Requires dms.create.', draftUpdateSchema, (deps, ctx, args) => updateDraft(deps, ctx, args)),
  t('dms_receive', 'File an incoming document from a base64 payload or an existing asset. Requires dms.create.', receiveSchema, (deps, ctx, args) => receiveDocument(deps, ctx, args)),
  t('dms_move', 'Move a document into a folder of the subject tree. Requires dms.create.', z.object({ id: z.string(), folder: z.string().nullable() }), (deps, ctx, args) => moveDocument(deps, ctx, args)),
  t('dms_link', 'Link a document to a contact, animal or project with a role. Requires dms.create.', linkSchema, (deps, ctx, args) => linkDocument(deps, ctx, args)),
  t('dms_file', 'File a draft: assign the number, render the pdf, freeze it. Requires dms.file.', z.object({ id: z.string() }), (deps, ctx, args) => fileDocument(deps, ctx, args)),
  t('dms_void', 'Void a filed document with a reason. The number stays taken. Requires dms.void.', voidSchema, (deps, ctx, args) => voidDocument(deps, ctx, args)),
  t('dms_delete_draft', 'Throw away a draft. Requires dms.deleteDraft.', z.object({ id: z.string() }), (deps, ctx, args) => deleteDraft(deps, ctx, args)),
  t('dms_manage_types', 'Create or change a document type. Requires dms.manage.', documentTypeCreateSchema, (deps, ctx, args) => createDocumentType(deps, ctx, args)),
  // Kein eigenes `dms_search`: Es nähme dasselbe Schema und riefe denselben
  // Service wie `dms_list`. Zwei Namen für eine Sache kosten einen Agenten eine
  // Entscheidung und geben ihm nichts dafür — die Suche steht in der
  // Beschreibung von `dms_list`.
  t(
    'dms_reindex',
    'Queue every filed document to be read again (requires dms.manage). The full text is recognised in the background, one document at a time.',
    z.object({}),
    async (deps, ctx) => reindexAllDocuments(deps, ctx),
  ),
];

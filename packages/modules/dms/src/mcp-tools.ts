import type { McpToolDefinition } from '@kompass/core';
import { z } from 'zod';
import {
  createDocumentFolder, createDocumentRule, createDocumentType, deleteDocumentFolder, deleteDocumentRule, documentFolderCreateSchema, documentFolderDeleteSchema,
  documentRuleCreateSchema, documentRuleDeleteSchema, documentRuleListSchema, documentRuleUpdateSchema, documentTypeCreateSchema, documentTypeListSchema, documentTypeUpdateSchema,
  listDocumentFolders, listDocumentRules, listDocumentTypes, updateDocumentRule, updateDocumentType,
} from './catalog';
import { suggestClassification, suggestSchema } from './classification';
import { clearDispatch, dispatchClearSchema, dispatchSchema, recordDispatch } from './dispatch';
import { createDraft, createReplacementDraft, deleteDraft, draftCreateSchema, draftUpdateSchema, fileDocument, replacementSchema, updateDraft } from './drafts';
import { createDocumentFollowUp, documentFollowUpSchema } from './follow-ups';
import { receiveDocument, receiveSchema } from './incoming';
import { addNote, deleteNote, noteAddSchema, noteIdSchema } from './notes';
import { relateDocuments, relateSchema, unrelateDocuments, unrelateSchema } from './relations';
import { documentListSchema, getDocumentRecord, linkDocument, linkSchema, listDocuments, moveDocument, moveDocumentSchema, unlinkDocument, unlinkSchema, voidDocument } from './service';
import { createSnippet, deleteSnippet, listSnippets, snippetCreateSchema, snippetIdSchema, snippetListSchema, snippetUpdateSchema, updateSnippet } from './snippets';
import { documentTextSchema, getDocumentText, reindexAllDocuments } from './text';

const t = <T>(def: McpToolDefinition<T>): McpToolDefinition => def as McpToolDefinition;
const voidSchema = z.object({ id: z.string().min(1), reason: z.string().trim().min(1).max(300) });
const idSchema = z.object({ id: z.string().min(1) });

export const DMS_MCP_TOOLS: McpToolDefinition[] = [
  // Lesen
  t({ name: 'dms_list', description: 'List and search documents in the file. Filters by direction, type, folder, phase, linked entity, relatedTo (another document), unsent (outgoing, filed, no dispatch note) and withOpenFollowUp; orderBy sorts by a column. The text filter searches subject, number and the recognised full text and returns the passage with its page for every full-text hit; terms shorter than three characters do not reach the full text. Requires dms.view.', inputSchema: documentListSchema, handler: (deps, ctx, args) => listDocuments(deps, ctx, args), service: listDocuments }),
  t({ name: 'dms_get', description: 'Read one document: metadata, links to contacts/animals/projects, relations to other documents, dispatch note, notes and follow-ups. Never the file itself — use dms_text for its content. Requires dms.view.', inputSchema: idSchema, handler: (deps, ctx, { id }) => getDocumentRecord(deps, ctx, id), service: getDocumentRecord }),
  t({ name: 'dms_text', description: 'Read the recognised full text of a document, page by page, or the state of recognition and why there is none yet. Requires dms.view.', inputSchema: documentTextSchema, handler: (deps, ctx, args) => getDocumentText(deps, ctx, args), service: getDocumentText }),
  t({ name: 'dms_types', description: 'List the document types with their number prefix and retention class. Requires dms.view.', inputSchema: documentTypeListSchema, handler: (deps, ctx, args) => listDocumentTypes(deps, ctx, args), service: listDocumentTypes }),
  t({ name: 'dms_folders', description: 'List the folders of the subject tree. Requires dms.view.', inputSchema: z.object({}), handler: (deps, ctx) => listDocumentFolders(deps, ctx), service: listDocumentFolders }),
  t({ name: 'dms_rules', description: 'List the filing rules that pre-fill the receive form. Requires dms.view.', inputSchema: documentRuleListSchema, handler: (deps, ctx, args) => listDocumentRules(deps, ctx, args), service: listDocumentRules }),
  t({ name: 'dms_snippets', description: 'List the text blocks available in the letter editor. Requires dms.view.', inputSchema: snippetListSchema, handler: (deps, ctx, args) => listSnippets(deps, ctx, args), service: listSnippets }),
  t({ name: 'dms_suggest_classification', description: 'Suggest type, folder and document date for a file about to be filed. Reads only, files nothing. Requires dms.view.', inputSchema: suggestSchema, handler: (deps, ctx, args) => suggestClassification(deps, ctx, args), service: suggestClassification }),

  // Entwurf und Ablage
  t({ name: 'dms_create_draft', description: 'Create an outgoing draft with subject, markdown body and links. Requires dms.create.', inputSchema: draftCreateSchema, handler: (deps, ctx, args) => createDraft(deps, ctx, args), service: createDraft }),
  t({ name: 'dms_update_draft', description: 'Change a draft that has not been filed yet. Requires dms.create.', inputSchema: draftUpdateSchema, handler: (deps, ctx, args) => updateDraft(deps, ctx, args), service: updateDraft }),
  t({ name: 'dms_file', description: 'File a draft: draw the number, render the pdf, freeze it. Requires dms.file.', inputSchema: idSchema, handler: (deps, ctx, args) => fileDocument(deps, ctx, args), service: fileDocument }),
  t({ name: 'dms_delete_draft', description: 'Throw away a draft. Requires dms.deleteDraft.', inputSchema: idSchema, handler: (deps, ctx, args) => deleteDraft(deps, ctx, args), service: deleteDraft }),
  t({ name: 'dms_receive', description: 'File an incoming pdf from a base64 payload with type, subject, document date, folder and links. Requires dms.create.', inputSchema: receiveSchema, handler: (deps, ctx, args) => receiveDocument(deps, ctx, args), service: receiveDocument }),
  t({ name: 'dms_void', description: 'Void a filed document with a reason. The number stays taken. Requires dms.void.', inputSchema: voidSchema, handler: (deps, ctx, args) => voidDocument(deps, ctx, args), service: voidDocument }),
  t({ name: 'dms_create_replacement', description: 'After voiding: create a new draft from a voided document with its subject, body and recipient, related as "replaces". Requires dms.create.', inputSchema: replacementSchema, handler: (deps, ctx, args) => createReplacementDraft(deps, ctx, args), service: createReplacementDraft }),
  t({ name: 'dms_move', description: 'Move a document into a folder of the subject tree (null = inbox). Requires dms.create.', inputSchema: moveDocumentSchema, handler: (deps, ctx, args) => moveDocument(deps, ctx, args), service: moveDocument }),

  // Bezüge
  t({ name: 'dms_link', description: 'Link a document to a contact, animal or project with a role. Requires dms.create.', inputSchema: linkSchema, handler: (deps, ctx, args) => linkDocument(deps, ctx, args), service: linkDocument }),
  t({ name: 'dms_unlink', description: 'Remove a link between a document and a contact, animal or project. Requires dms.create.', inputSchema: unlinkSchema, handler: (deps, ctx, args) => unlinkDocument(deps, ctx, args), service: unlinkDocument }),
  t({ name: 'dms_relate', description: 'Relate two documents: repliesTo, signedCopyOf, replaces or attachmentOf, read from documentId towards relatedDocumentId. Requires dms.create.', inputSchema: relateSchema, handler: (deps, ctx, args) => relateDocuments(deps, ctx, args), service: relateDocuments }),
  t({ name: 'dms_unrelate', description: 'Remove a relation between two documents. Requires dms.create.', inputSchema: unrelateSchema, handler: (deps, ctx, args) => unrelateDocuments(deps, ctx, args), service: unrelateDocuments }),

  // Versand, Notizen, Wiedervorlage
  t({ name: 'dms_dispatch', description: 'Record that a filed outgoing document was sent: date, channel key from the dms.dispatchChannels setting, optional note. Replaces an earlier note, audited with before and after. Requires dms.create.', inputSchema: dispatchSchema, handler: (deps, ctx, args) => recordDispatch(deps, ctx, args), service: recordDispatch }),
  t({ name: 'dms_dispatch_clear', description: 'Remove the dispatch note from a document. Requires dms.create.', inputSchema: dispatchClearSchema, handler: (deps, ctx, args) => clearDispatch(deps, ctx, args), service: clearDispatch }),
  t({ name: 'dms_add_note', description: 'Append a note to a document (working material, never part of the document). Requires dms.create.', inputSchema: noteAddSchema, handler: (deps, ctx, args) => addNote(deps, ctx, args), service: addNote }),
  t({ name: 'dms_delete_note', description: "Delete a note: your own with dms.create, anyone's with dms.manage.", inputSchema: noteIdSchema, handler: (deps, ctx, args) => deleteNote(deps, ctx, args), service: deleteNote }),
  t({ name: 'dms_create_follow_up', description: 'Create a follow-up on a document: due date, title, optional assignee. Requires dms.create and followUps.manage.', inputSchema: documentFollowUpSchema, handler: (deps, ctx, args) => createDocumentFollowUp(deps, ctx, args), service: createDocumentFollowUp }),

  // Stammdaten
  t({ name: 'dms_create_type', description: 'Create a document type with prefix, direction and retention class. Requires dms.manage.', inputSchema: documentTypeCreateSchema, handler: (deps, ctx, args) => createDocumentType(deps, ctx, args), service: createDocumentType }),
  t({ name: 'dms_update_type', description: 'Change a document type (label, direction, retention class, default folder, active, order). Requires dms.manage.', inputSchema: documentTypeUpdateSchema, handler: (deps, ctx, args) => updateDocumentType(deps, ctx, args), service: updateDocumentType }),
  t({ name: 'dms_create_folder', description: 'Create a folder in the subject tree. Requires dms.manage.', inputSchema: documentFolderCreateSchema, handler: (deps, ctx, args) => createDocumentFolder(deps, ctx, args), service: createDocumentFolder }),
  t({ name: 'dms_delete_folder', description: 'Delete an empty folder. Requires dms.manage.', inputSchema: documentFolderDeleteSchema, handler: (deps, ctx, args) => deleteDocumentFolder(deps, ctx, args), service: deleteDocumentFolder }),
  t({ name: 'dms_create_rule', description: 'Create a filing rule. Requires dms.manage.', inputSchema: documentRuleCreateSchema, handler: (deps, ctx, args) => createDocumentRule(deps, ctx, args), service: createDocumentRule }),
  t({ name: 'dms_update_rule', description: 'Change a filing rule. Requires dms.manage.', inputSchema: documentRuleUpdateSchema, handler: (deps, ctx, args) => updateDocumentRule(deps, ctx, args), service: updateDocumentRule }),
  t({ name: 'dms_delete_rule', description: 'Delete a filing rule. Requires dms.manage.', inputSchema: documentRuleDeleteSchema, handler: (deps, ctx, args) => deleteDocumentRule(deps, ctx, args), service: deleteDocumentRule }),
  t({ name: 'dms_create_snippet', description: 'Create a text block for the letter editor. Requires dms.manage.', inputSchema: snippetCreateSchema, handler: (deps, ctx, args) => createSnippet(deps, ctx, args), service: createSnippet }),
  t({ name: 'dms_update_snippet', description: 'Change a text block. Requires dms.manage.', inputSchema: snippetUpdateSchema, handler: (deps, ctx, args) => updateSnippet(deps, ctx, args), service: updateSnippet }),
  t({ name: 'dms_delete_snippet', description: 'Delete a text block. Requires dms.manage.', inputSchema: snippetIdSchema, handler: (deps, ctx, args) => deleteSnippet(deps, ctx, args), service: deleteSnippet }),
  t({ name: 'dms_reindex', description: 'Queue every filed document to be read again. The full text is recognised in the background, one document at a time. Requires dms.manage.', inputSchema: z.object({}), handler: (deps, ctx) => reindexAllDocuments(deps, ctx), service: reindexAllDocuments }),
];

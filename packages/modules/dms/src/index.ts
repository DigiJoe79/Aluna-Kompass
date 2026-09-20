export { canReadDocumentType, dmsGatePermissions, isProtectedType, requireDmsGate } from './access';
export * from './catalog';
export * from './classification';
export * from './dashboard';
export * from './dispatch';
export * from './drafts';
export * from './follow-ups';
export * from './incoming';
export * from './install';
export * from './issue';
export * from './linked';
export * from './manifest';
export * from './mcp-tools';
export { addNote, deleteNote, deleteNotesFor, noteAddSchema, noteIdSchema } from './notes';
export * from './owned';
export * from './provision';
export * from './record-references';
export { deleteRelationsFor, relateDocuments, relateSchema, unrelateDocuments, unrelateSchema } from './relations';
export type { DocumentRelationView } from './relations';
export * from './retention';
export * from './schema';
export { MIN_FULLTEXT_CHARS, SNIPPET_MARK_END, SNIPPET_MARK_START, SNIPPET_TOKENS } from './search';
export type { TextHit } from './search';
export * from './seed';
export {
  allocateDocumentNumber,
  deleteDocument,
  deleteDocumentSchema,
  documentListSchema,
  getDocument,
  getDocumentRecord,
  linkDocument,
  linkInputSchema,
  linkSchema,
  listDocuments,
  moveDocument,
  moveDocumentSchema,
  peekDocumentNumber,
  previewNextNumber,
  previewNumberSchema,
  readLinkedDocument,
  refuseReservedLinks,
  resolveFolder,
  unlinkDocument,
  unlinkSchema,
  voidDocument,
  voidDocumentInternal,
} from './service';
export type { DocumentFileState, DocumentRecord } from './service';
export * from './snippets';
export { checksumOf, DMS_MODULE_KEY, DOCUMENT_MAX_BYTES } from './storage';
export type { StoredFile } from './storage';
export * from './templates';
export * from './text';
export * from './worker';

import { ok, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { documentTypeFor } from './catalog';
import { documentLinks, documentRules, documents, type DocumentRuleRow } from './schema';

export const suggestSchema = z.object({
  filename: z.string().trim().min(1),
  senderEntityType: z.string().trim().min(1).optional(),
  senderEntityId: z.string().trim().min(1).optional(),
});

export type Suggestion = {
  typeKey: string | null;
  folder: string | null;
  documentDate: string | null;
  matchedRuleId: string | null;
};

function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Erkennt genau zwei Formen und sonst nichts:
 * \b(\d{4})-(\d{2})-(\d{2})\b und \b(\d{2})\.(\d{2})\.(\d{4})\b.
 */
export function dateFromFilename(filename: string): string | null {
  const isoMatch = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(filename);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (isValidDate(year, month, day)) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const deMatch = /\b(\d{2})\.(\d{2})\.(\d{4})\b/.exec(filename);
  if (deMatch) {
    const day = parseInt(deMatch[1], 10);
    const month = parseInt(deMatch[2], 10);
    const year = parseInt(deMatch[3], 10);
    if (isValidDate(year, month, day)) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

export async function suggestClassification(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<Suggestion>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;

  const parsed = validate(deps, suggestSchema, input);
  if (!parsed.ok) return parsed;

  const documentDate = dateFromFilename(parsed.value.filename);

  let senderName: string | null = null;
  if (parsed.value.senderEntityType === 'contact' && parsed.value.senderEntityId) {
    const contact = deps.db
      .select()
      .from(contacts)
      .where(eq(contacts.id, parsed.value.senderEntityId))
      .get();
    if (contact) {
      senderName = displayName(contact) || null;
    }
  }

  const rules = deps.db
    .select()
    .from(documentRules)
    .where(eq(documentRules.isActive, true))
    .orderBy(asc(documentRules.sortOrder), asc(documentRules.id))
    .all();

  let matchedRule: DocumentRuleRow | null = null;
  const filenameLower = parsed.value.filename.toLowerCase();
  const senderNameLower = senderName?.toLowerCase() ?? '';

  for (const rule of rules) {
    const term = rule.matchContains.toLowerCase();
    if (rule.matchField === 'filename' && filenameLower.includes(term)) {
      matchedRule = rule;
      break;
    }
    if (rule.matchField === 'senderName' && senderNameLower && senderNameLower.includes(term)) {
      matchedRule = rule;
      break;
    }
  }

  let typeKey: string | null = null;
  let folder: string | null = null;
  let matchedRuleId: string | null = null;

  if (matchedRule) {
    matchedRuleId = matchedRule.id;
    typeKey = matchedRule.thenTypeKey ?? null;
    folder = matchedRule.thenFolder ?? null;
    if (!folder && typeKey) {
      const docType = documentTypeFor(deps.db, typeKey);
      folder = docType?.defaultFolder ?? null;
    }
  } else if (parsed.value.senderEntityType && parsed.value.senderEntityId) {
    const lastLink = deps.db
      .select({ documentId: documentLinks.documentId })
      .from(documentLinks)
      .innerJoin(documents, eq(documents.id, documentLinks.documentId))
      .where(
        and(
          eq(documentLinks.entityType, parsed.value.senderEntityType),
          eq(documentLinks.entityId, parsed.value.senderEntityId),
          eq(documentLinks.role, 'sender'),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(1)
      .get();

    if (lastLink) {
      const prevDoc = deps.db
        .select()
        .from(documents)
        .where(eq(documents.id, lastLink.documentId))
        .get();
      if (prevDoc) {
        typeKey = prevDoc.typeKey;
        const docType = documentTypeFor(deps.db, typeKey);
        folder = docType?.defaultFolder ?? null;
      }
    }
  }

  return ok({
    typeKey,
    folder,
    documentDate,
    matchedRuleId,
  });
}

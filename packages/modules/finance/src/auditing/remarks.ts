import { isoNow, newId, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { documentLinks } from '@kompass/module-dms';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { reportDefinition } from '../reporting/catalog';
import { financeAuditAuditors, financeAuditRemarkPosts, financeAuditRemarks, financeEntries, financeEntryDocuments, financeFiscalYears, type FinanceAuditRemarkRow } from '../schema';
import { requireAuditorOfYear, requireAuditRead } from './access';
import type { AuditRemarkView } from './types';

/**
 * Vermerke der Kassenprüfung (Spec § D1 Schritte 3–4, Designer N3): Frage oder Feststellung eines Prüfers an Buchung,
 * Beleg, Bericht oder Jahr; die Schatzmeisterin antwortet, der Prüfer fragt nach oder markiert als geklärt. Schreiben
 * persönlicher Schritt (humanOnly) — die Prüfung ist eine persönliche Erklärung, ein Agent antwortet nicht.
 */

const loadRemark = (db: DbOrTx, id: string): FinanceAuditRemarkRow | null => db.select().from(financeAuditRemarks).where(eq(financeAuditRemarks.id, id)).get() ?? null;

export function remarkViewInternal(db: DbOrTx, row: FinanceAuditRemarkRow): AuditRemarkView {
  const posts = db.select().from(financeAuditRemarkPosts).where(eq(financeAuditRemarkPosts.remarkId, row.id)).orderBy(asc(financeAuditRemarkPosts.at), asc(financeAuditRemarkPosts.id)).all();
  return {
    id: row.id, kind: row.kind, target: { type: row.targetType, id: row.targetId }, text: row.text, authorAuditorId: row.authorAuditorId, enteredByUserId: row.enteredByUserId,
    state: row.state, createdAt: row.createdAt, posts: posts.map((p) => ({ id: p.id, kind: p.kind, byUserId: p.byUserId, text: p.text, at: p.at })),
  };
}

export function remarksOfYearInternal(db: DbOrTx, fiscalYearId: string): FinanceAuditRemarkRow[] {
  return db.select().from(financeAuditRemarks).where(eq(financeAuditRemarks.fiscalYearId, fiscalYearId)).orderBy(asc(financeAuditRemarks.createdAt), asc(financeAuditRemarks.id)).all();
}

/** Nicht geklärte Vermerke je Ziel (`entry:<id>`, `document:<id>`, `report:<key>`, `year:<id>`). */
export function openRemarksByTargetInternal(db: DbOrTx, fiscalYearId: string): Map<string, number> {
  return new Map([...remarkStatesByTargetInternal(db, fiscalYearId)].map(([key, s]) => [key, s.open + s.answered]));
}

/**
 * Je Ziel die nicht geklärten Vermerke nach Zustand — die eine Quelle für die Marke an einer Zeile (offen oder
 * beantwortet, Designer Runde 7, 274/275) und für die Zahl „nicht geklärt“.
 */
export function remarkStatesByTargetInternal(db: DbOrTx, fiscalYearId: string): Map<string, { open: number; answered: number }> {
  const states = new Map<string, { open: number; answered: number }>();
  for (const r of db.select({ t: financeAuditRemarks.targetType, id: financeAuditRemarks.targetId, state: financeAuditRemarks.state }).from(financeAuditRemarks).where(and(eq(financeAuditRemarks.fiscalYearId, fiscalYearId), ne(financeAuditRemarks.state, 'resolved'))).all()) {
    const key = `${r.t}:${r.id}`;
    const s = states.get(key) ?? { open: 0, answered: 0 };
    if (r.state === 'open') s.open += 1;
    else s.answered += 1;
    states.set(key, s);
  }
  return states;
}

/** Alle Vermerke an einer Buchung, älteste zuerst (Buchungsseite, Abschnitt „Vermerke“). */
export function entryRemarksInternal(db: DbOrTx, entryId: string): AuditRemarkView[] {
  return db.select().from(financeAuditRemarks).where(and(eq(financeAuditRemarks.targetType, 'entry'), eq(financeAuditRemarks.targetId, entryId))).orderBy(asc(financeAuditRemarks.createdAt)).all().map((r) => remarkViewInternal(db, r));
}

/** Gehört das Ziel zum Jahr? Buchung des Jahres; Dokument am Jahr oder an einer seiner Buchungen; Bericht im Katalog; das Jahr selbst. */
function targetBelongsToYear(db: DbOrTx, fiscalYearId: string, type: 'entry' | 'document' | 'report' | 'year', id: string): boolean {
  if (type === 'year') return id === fiscalYearId;
  if (type === 'report') return Boolean(reportDefinition(id)?.available);
  if (type === 'entry') {
    const entry = db.select({ fiscalYearId: financeEntries.fiscalYearId, status: financeEntries.status }).from(financeEntries).where(eq(financeEntries.id, id)).get();
    return entry?.status === 'final' && entry.fiscalYearId === fiscalYearId;
  }
  if (db.select({ id: documentLinks.id }).from(documentLinks).where(and(eq(documentLinks.documentId, id), eq(documentLinks.entityType, 'financeFiscalYear'), eq(documentLinks.entityId, fiscalYearId))).get()) return true;
  const entryIds = db.select({ id: financeEntries.id }).from(financeEntries).where(eq(financeEntries.fiscalYearId, fiscalYearId)).all().map((e) => e.id);
  if (entryIds.length === 0) return false;
  if (db.select({ id: financeEntryDocuments.id }).from(financeEntryDocuments).where(and(eq(financeEntryDocuments.documentId, id), inArray(financeEntryDocuments.entryId, entryIds))).get()) return true;
  return Boolean(db.select({ id: documentLinks.id }).from(documentLinks).where(and(eq(documentLinks.documentId, id), eq(documentLinks.entityType, 'financeEntry'), inArray(documentLinks.entityId, entryIds))).get());
}

const remarkText = z.string().trim().min(1).max(2000);

const listSchema = z.object({
  fiscalYearId: z.string().min(1),
  state: z.enum(['open', 'answered', 'resolved']).optional(),
  targetType: z.enum(['entry', 'document', 'report', 'year']).optional(),
  targetId: z.string().min(1).optional(),
});

/** `finance.read` oder `finance.audit`, auch über MCP: die Vermerke eines Jahres, gefiltert, mit offenen je Buchung. */
export async function listAuditRemarks(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ remarks: AuditRemarkView[]; openByEntry: Record<string, number>; remarksOnEntries: { open: number; answered: number } }>> {
  const denied = requireAuditRead(ctx);
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!deps.db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).where(eq(financeFiscalYears.id, v.fiscalYearId)).get()) return notFound('financeFiscalYear', v.fiscalYearId);
  const rows = remarksOfYearInternal(deps.db, v.fiscalYearId).filter((r) => (!v.state || r.state === v.state) && (!v.targetType || r.targetType === v.targetType) && (!v.targetId || r.targetId === v.targetId));
  const openByEntry = Object.fromEntries([...openRemarksByTargetInternal(deps.db, v.fiscalYearId)].filter(([k]) => k.startsWith('entry:')).map(([k, n]) => [k.slice('entry:'.length), n]));
  // Designer Runde 8, 281: Abschnitt 1 (Journal) zählt nur Vermerke an Buchungen und nennt ihren Zustand.
  const remarksOnEntries = { open: 0, answered: 0 };
  for (const [key, state] of remarkStatesByTargetInternal(deps.db, v.fiscalYearId)) {
    if (!key.startsWith('entry:')) continue;
    remarksOnEntries.open += state.open;
    remarksOnEntries.answered += state.answered;
  }
  return ok({ remarks: rows.map((r) => remarkViewInternal(deps.db, r)), openByEntry, remarksOnEntries });
}

const createSchema = z.object({
  fiscalYearId: z.string().min(1),
  kind: z.enum(['question', 'finding']),
  targetType: z.enum(['entry', 'document', 'report', 'year']),
  targetId: z.string().min(1),
  text: remarkText,
  /** Für einen Papier-Prüfer desselben Jahres („von <Kontakt>, eingetragen von <Prüfer>“). */
  onBehalfOfAuditorId: z.string().min(1).optional(),
});

/** `finance.audit`, persönlicher Schritt (humanOnly), nur Prüfer des Jahres. */
export async function createAuditRemark(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditRemarkView>> {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, createSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const checked = requireAuditorOfYear(deps, ctx, v.fiscalYearId);
  if ('failure' in checked) return checked.failure;
  let author = checked.auditor.id;
  if (v.onBehalfOfAuditorId) {
    const paper = deps.db.select().from(financeAuditAuditors).where(eq(financeAuditAuditors.id, v.onBehalfOfAuditorId)).get();
    if (!paper || paper.fiscalYearId !== v.fiscalYearId || paper.mode !== 'paper') return financeConflict('remarkOnBehalfNotPaper');
    author = paper.id;
  }
  if (!targetBelongsToYear(deps.db, v.fiscalYearId, v.targetType, v.targetId)) return financeConflict('remarkTargetNotInYear', { designation: checked.year.designation });
  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(financeAuditRemarks).values({ id, fiscalYearId: v.fiscalYearId, kind: v.kind, targetType: v.targetType, targetId: v.targetId, text: v.text, authorAuditorId: author, enteredByUserId: ctx.userId ?? 'system', state: 'open', createdAt: now, updatedAt: now }).run();
    financeAudit(tx, deps, ctx, { action: 'finance.audit.remark.create', entity: 'financeAuditRemark', id, after: { fiscalYearId: v.fiscalYearId, kind: v.kind, targetType: v.targetType, state: 'open', onBehalf: author !== checked.auditor.id }, params: { kind: v.kind } });
    return ok(remarkViewInternal(tx, loadRemark(tx, id)!));
  });
}

const postSchema = z.object({ remarkId: z.string().min(1), text: remarkText });

function addPost(tx: DbOrTx, deps: Deps, ctx: CallContext, row: FinanceAuditRemarkRow, kind: 'answer' | 'followUp', text: string, state: 'open' | 'answered') {
  const now = isoNow(deps.clock);
  tx.insert(financeAuditRemarkPosts).values({ id: newId(), remarkId: row.id, kind, byUserId: ctx.userId ?? 'system', text, at: now }).run();
  tx.update(financeAuditRemarks).set({ state, updatedAt: now }).where(eq(financeAuditRemarks.id, row.id)).run();
}

/** `finance.entriesWrite`, persönlicher Schritt (humanOnly): die Schatzmeisterin antwortet — der Vermerk steht dann auf „beantwortet“. */
export async function answerAuditRemark(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditRemarkView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, postSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadRemark(deps.db, parsed.value.remarkId);
  if (!row) return notFound('financeAuditRemark', parsed.value.remarkId);
  if (row.state === 'resolved') return financeConflict('remarkResolved');
  return deps.db.transaction((tx: DbOrTx) => {
    addPost(tx, deps, ctx, row, 'answer', parsed.value.text, 'answered');
    financeAudit(tx, deps, ctx, { action: 'finance.audit.remark.answer', entity: 'financeAuditRemark', id: row.id, before: { state: row.state }, after: { state: 'answered' }, params: { kind: row.kind } });
    return ok(remarkViewInternal(tx, loadRemark(tx, row.id)!));
  });
}

/** `finance.audit`, persönlicher Schritt (humanOnly), Prüfer des Jahres: nachfragen — der Vermerk ist wieder offen. */
export async function followUpAuditRemark(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditRemarkView>> {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, postSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadRemark(deps.db, parsed.value.remarkId);
  if (!row) return notFound('financeAuditRemark', parsed.value.remarkId);
  const checked = requireAuditorOfYear(deps, ctx, row.fiscalYearId);
  if ('failure' in checked) return checked.failure;
  if (row.state === 'resolved') return financeConflict('remarkResolved');
  return deps.db.transaction((tx: DbOrTx) => {
    addPost(tx, deps, ctx, row, 'followUp', parsed.value.text, 'open');
    financeAudit(tx, deps, ctx, { action: 'finance.audit.remark.followUp', entity: 'financeAuditRemark', id: row.id, before: { state: row.state }, after: { state: 'open' }, params: { kind: row.kind } });
    return ok(remarkViewInternal(tx, loadRemark(tx, row.id)!));
  });
}

const resolveSchema = z.object({ remarkId: z.string().min(1) });

/** `finance.audit`, persönlicher Schritt (humanOnly), Prüfer des Jahres: als geklärt markieren. */
export async function resolveAuditRemark(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditRemarkView>> {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, resolveSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadRemark(deps.db, parsed.value.remarkId);
  if (!row) return notFound('financeAuditRemark', parsed.value.remarkId);
  const checked = requireAuditorOfYear(deps, ctx, row.fiscalYearId);
  if ('failure' in checked) return checked.failure;
  if (row.state === 'resolved') return financeConflict('remarkResolved');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financeAuditRemarks).set({ state: 'resolved', updatedAt: isoNow(deps.clock) }).where(eq(financeAuditRemarks.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.audit.remark.resolve', entity: 'financeAuditRemark', id: row.id, before: { state: row.state }, after: { state: 'resolved' }, params: { kind: row.kind } });
    return ok(remarkViewInternal(tx, loadRemark(tx, row.id)!));
  });
}

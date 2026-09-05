import type { DocumentRenderContext, DocumentTemplate } from '@kompass/core';
import { z } from 'zod';
import type { TypstRenderer } from './renderer';

export function firstFontFamily(stack: string): string {
  const first = stack.split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '');
}

export function formatGermanDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function buildPayload(data: unknown, ctx: DocumentRenderContext) {
  const t = ctx.theme.tokens;
  return {
    data,
    organization: ctx.organization,
    number: ctx.number,
    issuedDate: formatGermanDate(ctx.issuedAt),
    brand: {
      primary: t['color-primary'].light,
      accent: t['color-accent'].light,
      ink: t.ink.light,
      muted: t.muted.light,
      line: t.line.light,
      fontBody: firstFontFamily(t['font-body'].light),
      fontHeading: firstFontFamily(t['font-heading'].light),
      fontMono: firstFontFamily(t['font-mono'].light),
    },
    hasLogo: ctx.logo !== null,
  };
}

const letterheadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().max(5000).default(''),
  letterhead: z.boolean().default(true),
});

const auditExportSchema = z.object({
  title: z.string().trim().min(1).max(120),
  filters: z.record(z.string(), z.string()).default({}),
  entries: z.array(z.object({
    occurredAt: z.string(),
    userName: z.string().nullable(),
    channel: z.string(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string().nullable(),
    summary: z.string(),
  })).max(2000),
});

export function coreDocumentTemplates(renderer: TypstRenderer): DocumentTemplate[] {
  const letterhead: DocumentTemplate<z.infer<typeof letterheadSchema>> = {
    key: 'letterhead',
    prefix: 'BRF',
    schema: letterheadSchema,
    render: (data, ctx) => renderer.render('letterhead.typ', buildPayload(data, ctx), ctx.logo),
  };
  const auditExport: DocumentTemplate<z.infer<typeof auditExportSchema>> = {
    key: 'audit-log-export',
    prefix: 'PRO',
    schema: auditExportSchema,
    permission: 'audit.view',
    render: (data, ctx) => renderer.render('audit-log-export.typ', buildPayload({ ...data, entries: data.entries.map((e) => ({ ...e, userName: e.userName ?? '—', entityId: e.entityId ?? null })) }, ctx), ctx.logo),
  };
  return [letterhead as DocumentTemplate, auditExport as DocumentTemplate];
}

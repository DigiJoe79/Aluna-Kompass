import { enabledManifests, parseHandbookIndex, readHandbookIndex, readHandbookPage } from '@kompass/core';
import { renderHandbook } from '@kompass/markdown';
import { NextResponse } from 'next/server';
import { getDeps, runtimeEnv } from '@/lib/deps';
import { helpDocFor, helpEntries } from '@/lib/help';
import { optionalSession } from '@/lib/request-context';

/** Was das Hilfe-Panel zur Seite unter `path` zeigt: den Kurzabsatz, oder ohne Treffer das Inhaltsverzeichnis. */
export async function GET(request: Request): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const pathname = new URL(request.url).searchParams.get('path') ?? '/';
  const deps = getDeps();
  const env = runtimeEnv();
  const entries = helpEntries(deps.registry.manifests, new Set(enabledManifests(deps).map((m) => m.key)));
  const doc = helpDocFor(entries, pathname);
  const page = doc ? readHandbookPage(env, doc) : null;
  if (page) {
    return NextResponse.json({ doc: page.doc, title: page.title, href: `/help/${page.doc}`, leadHtml: await renderHandbook(page.lead, { doc: page.doc }) });
  }
  const chapters = parseHandbookIndex(readHandbookIndex(env));
  const index = chapters
    .map((c) => (c.pages.length === 1 && c.pages[0]!.title === c.title ? `- [${c.title}](${c.pages[0]!.doc}.md)` : [`- ${c.title}`, ...c.pages.map((p) => `  - [${p.title}](${p.doc}.md)`)].join('\n')))
    .join('\n');
  return NextResponse.json({ doc: null, indexHtml: await renderHandbook(index, { doc: 'inhalt' }) });
}

'use server';

import { renderMarkdown } from '@kompass/markdown';
import { requireSession } from '@/lib/request-context';

export async function renderMarkdownAction(markdown: string): Promise<string> {
  await requireSession();
  return renderMarkdown(String(markdown ?? '').slice(0, 40_000));
}

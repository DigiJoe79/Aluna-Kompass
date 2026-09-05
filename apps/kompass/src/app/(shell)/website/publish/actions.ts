'use server';

import { exportSiteContent } from '@kompass/module-website';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getTranslations } from 'next-intl/server';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function runCheckAction(): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const dir = await mkdtemp(path.join(tmpdir(), 'kompass-check-'));
  try {
    const result = await exportSiteContent(deps, ctx, { jobDir: dir });
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', data: { contentHash: result.value.contentHash, gaps: result.value.gaps, violations: result.value.violations } };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

'use client';

import type { PublishRecord } from '@kompass/module-site';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCard } from './check-card';
import { ConnectionCard } from './connection-card';
import { DiffCard, type PublishDiff } from './diff-card';
import { PublishHistory } from './history';
import { JobStatus } from './job-status';
import { PreviewCard, type PreviewData } from './preview-card';
import { PublishCard } from './publish-card';

export function PublishClient({
  env,
  publicUrl,
  hasDeploy,
  history,
}: {
  env: string;
  publicUrl: string | null;
  hasDeploy: boolean;
  history: PublishRecord[];
}) {
  const router = useRouter();
  const [diff, setDiff] = useState<PublishDiff | null>(null);
  const [hasViolations, setHasViolations] = useState(false);
  const [previewHash, setPreviewHash] = useState<string | null>(null);

  return (
    <div className="flex max-w-[880px] flex-col gap-4">
      <JobStatus onFinished={() => router.refresh()} />
      <CheckCard
        onResult={(c) => {
          setHasViolations(c.violations.length > 0);
        }}
      />
      <PreviewCard
        onResult={(data: PreviewData) => {
          setDiff(data.diff);
          setHasViolations(data.violations.length > 0);
          setPreviewHash(data.contentHash);
        }}
      />
      <DiffCard diff={diff} />
      <ConnectionCard hasDeploy={hasDeploy} />
      <PublishCard
        env={env}
        publicUrl={publicUrl}
        hasDeploy={hasDeploy}
        diff={diff}
        hasViolations={hasViolations}
        previewHash={previewHash}
        onPublished={() => {
          // router.refresh() holt nur die Server-Props neu (z.B. die
          // Historie) — der Client-State dieser Seite bleibt sonst stehen und
          // zeigte die gerade publizierten Dateien weiter als ausstehend an.
          setDiff(null);
          setHasViolations(false);
          setPreviewHash(null);
          router.refresh();
        }}
      />
      <PublishHistory items={history} />
    </div>
  );
}

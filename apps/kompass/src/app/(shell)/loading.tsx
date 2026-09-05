import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton className="h-7 w-64 bg-surface-2" />
      <Skeleton className="h-10 w-full bg-surface-2" />
      <Skeleton className="h-[var(--row-h)] w-full bg-surface-2" />
      <Skeleton className="h-[var(--row-h)] w-full bg-surface-2" />
      <Skeleton className="h-[var(--row-h)] w-full bg-surface-2" />
    </div>
  );
}

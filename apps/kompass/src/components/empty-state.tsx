export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <section className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface p-7 text-center">
      <h3 className="font-heading text-[17px]">{title}</h3>
      <p className="max-w-[480px] text-[14px] text-ink-2">{text}</p>
    </section>
  );
}

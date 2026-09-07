import { PageHeader } from '@/components/page-header';

export default function PreviewFramePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Webseiten-Vorschau"
        description="Vollständige Vorschau der statischen Webseite unter dem aktuellen Kompass-Datenstand."
      />
      <div className="rounded-md border border-line overflow-hidden bg-white">
        <iframe
          src="/site/preview/"
          title="Vorschau"
          className="h-[80vh] w-full border-0"
        />
      </div>
    </div>
  );
}

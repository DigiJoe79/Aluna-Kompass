import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * Ein PDF als Blätter (Designer Runde 6, Punkt 4; Freigabe Joe 2026-10-25): jede Seite ein Bild, untereinander, je ein
 * weißes Blatt mit 1 px `line-strong`, ohne Schatten, 16 px Abstand. Querformat in der Breite der Inhaltsspalte,
 * Hochformat höchstens 820 px breit und linksbündig (Designer Runde 7, 16a B) — sonst wäre ein Blatt höher als jeder
 * Bildschirm. Der Rahmen steht schon im Seitenverhältnis da, bevor das Bild lädt — nichts springt. Darunter rechts an
 * der Kante des Blatts „PDF öffnen“ (neuer Tab). Am Telefon nur Seite 1 und „Alle n Seiten als PDF öffnen“. Die Bilder
 * rendert der Server (`pdftoppm`), die Adresse je Seite und Dichte kommt vom Aufrufer. Ohne bekannte Seitenzahl bleibt
 * nur der Link. Hat das PDF keinen Inhalt (`empty`, der Satz des Papiers), steht statt der Blätter eine Zeile mit dem
 * Satz und „PDF öffnen“, in der Kante eines Blatts und so hoch wie ihr Inhalt (16a D).
 */
export function PdfPages({ title, pageCount, pageSrc, pdfHref, orientation, empty = null }: { title: string; pageCount: number | null; pageSrc: (page: number, scale: 1 | 2) => string; pdfHref: string; orientation: 'portrait' | 'landscape'; empty?: string | null }) {
  const t = useTranslations('common.pdfPages');
  const link = 'text-link underline-offset-2 hover:underline';
  if (empty) {
    return (
      <div className="flex flex-wrap items-center gap-3 border border-line-strong bg-surface px-4 py-3.5" data-slot="pdf-pages-empty">
        <p className="flex-1 text-body text-ink-2">{empty}</p>
        <a href={pdfHref} target="_blank" rel="noopener" className={link}>
          {t('open')}
        </a>
      </div>
    );
  }
  if (!pageCount) {
    return (
      <p className="flex justify-end">
        <a href={pdfHref} target="_blank" rel="noopener" className={link}>
          {t('open')}
        </a>
      </p>
    );
  }
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  return (
    <div className={cn('flex flex-col gap-4', orientation === 'portrait' && 'max-w-[820px]')} data-slot="pdf-pages">
      {pages.map((page) => (
        <div key={page} data-phone={page > 1 ? 'hidden' : undefined} className={cn('relative w-full border border-line-strong bg-surface-2', orientation === 'landscape' ? 'aspect-[297/210]' : 'aspect-[210/297]', page > 1 && 'max-sm:hidden')}>
          <img src={pageSrc(page, 1)} srcSet={`${pageSrc(page, 1)} 1x, ${pageSrc(page, 2)} 2x`} alt={t('alt', { page, total: pageCount, title })} loading={page > 2 ? 'lazy' : 'eager'} decoding="async" className="absolute inset-0 size-full object-contain" />
        </div>
      ))}
      <p className="flex justify-end">
        <a href={pdfHref} target="_blank" rel="noopener" data-phone="hidden" className={cn(link, 'max-sm:hidden')}>
          {t('open')}
        </a>
        <a href={pdfHref} target="_blank" rel="noopener" data-phone="only" className={cn(link, 'sm:hidden')}>
          {t('openAll', { total: pageCount })}
        </a>
      </p>
    </div>
  );
}

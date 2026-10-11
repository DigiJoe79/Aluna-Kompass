import { redirect } from 'next/navigation';
import { panelHref } from '@/components/panel-nav';

/** Lesezeichen und Handbuch-Links von vor 0.2.5: Das Template liegt jetzt unter Einrichtung → Webseite → Vorlage. */
export default function SiteTemplateRedirect(): never {
  redirect(panelHref('/admin/site', 'template'));
}

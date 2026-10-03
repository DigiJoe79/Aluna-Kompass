import { redirect } from 'next/navigation';

/** Lesezeichen und Handbuch-Links von vor 0.2.5: Das Template liegt jetzt in den Einstellungen. */
export default function SiteTemplateRedirect(): never {
  redirect('/admin/site?panel=template');
}
